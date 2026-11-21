# 17. The backend's image lives in the always-on stack, and CI builds it

- **Status:** Accepted
- **Date:** 2026-11-20

## Context

The session stack held the backend's ECR repository, so `make aws-down` deleted it with its images, and each `make aws-up` built the image on the developer's Mac and pushed it again, for 2 to 3 minutes. Roadmap step 5 asks GitHub Actions to build the image and deploy it to ECS. With the repository gone between sessions, CI would have nowhere to push after a merge, and merges happen between sessions, once a branch has been tested on AWS.

The options:

- **ECR in the always-on stack.** The image outlives sessions: CI pushes one after each merge to `main`, and `make aws-up` starts it. Storage costs $0.10 a GB a month, so a few cents for a few images of about 86 MB.
- **ECR stays in the session stack, and CI builds only while a session runs.** Nothing to pay between sessions, but CI would rarely run, since merges come after `make aws-down`, and `make aws-up` would keep building locally.
- **GitHub's container registry.** Free for a public repo, but a second registry, with its own sign-in, outside the AWS account that runs the image.

## Decision

- The ECR repository `dashgen-backend` moves to the always-on stack. It isn't force-deleted, so nothing deletes its images by accident. The session stack finds it by name.
- GitHub Actions builds the image after each merge to `main`, on its ARM runner, and pushes it as `main` and `main-<commit>`, with an OIDC role of its own that can only push to the repository, copy the session's task definitions into the two families that deploys use, run the migrations task and restart the backend's service. The tasks it starts get the session's secrets, as any deploy's do, so only workflows on `main` can take it. When a session runs `main`, it then deploys the image there: the migrations, then the backend. Between sessions, it only pushes. Runs on `main` go one at a time, but GitHub doesn't promise merge order, so a run, first or rerun, moves `main` only when git confirms that its commit is the one `main`'s image comes from, or newer: an older run can't roll a newer image back, and when git can't tell, the job fails rather than guess. A rerun of the newest keeps the image its first run pushed.
- Every deploy, CI's or `make aws-deploy`'s, pins one image by its digest. It reads which image the tag points to once, registers copies of the session's two task definition templates with that digest in place of the tag, and runs the migrations and the backend on the copies. So the backend always runs the code whose migrations ran, even when a merge moves `main` in the middle of a deploy. Terraform registers only the templates, in families of their own, `dashgen-backend-template` and `dashgen-migrate-template`, so the newest template always has its settings, like `AI_MODEL`. It leaves the running service to the deploy, so an apply never restarts the backend on an image that isn't built or migrated yet.
- Deploys take turns. Each holds a lock, one item in a DynamoDB table in the session stack, from reading which image the session runs to the backend's update. In a `dev` session, `make aws-deploy` builds under the lock, and deploys its own build by its digest. Right before each change to ECS, a deploy checks that it still holds the lock and renews it, so one whose lock ran out stops instead of undoing a newer deploy. And a deploy waits for any migrations task still running, like one that an earlier deploy stopped waiting for. That deploy keeps its lock until it expires, since right after a start, ECS can leave a task out of its lists for a moment. So CI's and `make`'s deploys never interleave and leave the older image running, and CI never puts `main` back while `make` deploys `dev`. GitHub's own concurrency setting only covers CI's runs. A lock expires after 30 minutes, so one that a stopped deploy left goes away.
- `TF_VAR_image_tag` picks the session's image: `main`, the default, which `make aws-up` starts without building, or `dev`, which `make aws-up` builds from your own code, tagged `dev` and `dev-<commit>`, to test a branch. In a `dev` session, `make aws-up` stops unless the variable is set, so running it again, as to switch models, never switches the session to `main` by accident.
- Two cleanup rules. CI's newest 3 `main-*` images stay however old they are, since a session can start `main`'s image weeks after the last merge, and ECS can still go back to the one before it. Every other image expires a week after its push. That second rule goes by age, not by count: a count could expire the image ECS still runs, after a few newer builds failed to deploy, while no image pushed in a session, which lasts hours, expires during it. An image from an earlier session can still be close to its week, so a deploy refuses a `dev` image over 6 days old.
- `make aws-up` checks that `main`'s image exists before Terraform builds anything, so it never builds a stack that can't start.

## Consequences

- The image outlives sessions, and a session that runs `main` builds nothing, so `make aws-up` is 2 to 3 minutes faster and needs no Docker.
- What runs on AWS in a `main` session is what CI built from `main`, after its checks passed.
- It costs a few cents a month at the usual rate of a few pushes a week: CI's 3 newest images and a week of others, 86 MB each at $0.10 a GB, less where they share layers. The second rule limits how long images stay, not how many, so a week of many pushes costs more.
- ECS loses its way back only after 3 merges in a row fail to deploy in one session, since each pushes a newer `main` image past the one ECS still runs.
- ECS keeps every deploy's copies, in `dashgen-backend` and `dashgen-migrate`. They cost nothing, but they pile up in the console. The running service no longer follows Terraform, so a change to a template, like `AI_MODEL`, reaches the backend with the next deploy, which `make aws-up` always runs.
- A deploy waits for the one before it, and up to 30 minutes for a lock that a stopped deploy left, as when the sign-in expires in the middle of one. CI's job allows for that wait.
- ECS can't check the lock itself, so a gap is left: the check and the change are a fraction of a second apart, and the check gives the deploy 30 more minutes, so an older deploy's change can only land late after a pause of over 30 minutes right between the two.
- The first `main` image comes with the first merge after the role is set up. Until then, only a `dev` session starts.
- The always-on stack must be applied with no session up, and before the next `make aws-up`, since the session stack now looks the repository up. A session made before this change still holds its own copy of the repository, under the same name.
- A session still makes 47 resources, as the deploy lock's table takes the repository's place, and `make aws-down` leaves the repository and its images.
- Images now stay in the account. They hold no secrets: keys and the database password come from Secrets Manager when a task starts, and the image gets only what `.dockerignore` lists.
