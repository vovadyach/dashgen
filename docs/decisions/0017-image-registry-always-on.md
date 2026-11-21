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

- The ECR repository `dashgen-backend` moves to the always-on stack, with a lifecycle rule that expires each image a week after its push. The rule goes by age, not by count: a count could expire the image ECS still runs, after a few newer builds failed to deploy, while no image pushed in a session, which lasts hours, expires during it. The repository isn't force-deleted, so nothing deletes its images by accident. An image from an earlier session can still be close to its week, so `make aws-migrate` and `make aws-start` refuse one over 6 days old.
- The session stack finds it by name, and its tasks pull from it as before.
- Next, in a change of its own: GitHub Actions builds the image after each merge to `main` and pushes it, with an OIDC role of its own, and deploys it when a session runs `main`. `make aws-up` then starts that image instead of building one, and `TF_VAR_image_tag=dev` keeps building local code, to test a branch. Since that image can be older than a week, the cleanup rule will then spare the images tagged `main` and `dev`.

## Consequences

- The image outlives sessions, so a session no longer needs to push it once CI builds it.
- It costs a few cents a month at the usual rate of a few pushes a week: a week's images of 86 MB at $0.10 a GB, less where they share layers, and nothing once a week passes with no push. The rule limits how long images stay, not how many, so a week of many pushes costs more.
- The always-on stack must be applied with no session up, and before the next `make aws-up`, since the session stack now looks the repository up. A session made before this change still holds its own copy of the repository, under the same name.
- A session makes 46 resources instead of 47, and `make aws-down` leaves the repository and its images.
- Images now stay in the account. They hold no secrets: keys and the database password come from Secrets Manager when a task starts, and the image gets only what `.dockerignore` lists.
