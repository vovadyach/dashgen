# The backend's image, which ECS will run on AWS (step 5). It's built from the
# repo's root, since the backend needs the contracts package beside it:
#   docker build --file backend/Dockerfile .
# Only what .dockerignore lets in reaches it, so no .env file ever does.

# Alpine keeps the image small. The backend's production packages are plain
# JavaScript, so Alpine's musl instead of glibc makes no difference to them.
FROM node:24.21.0-alpine3.24

WORKDIR /app

# The package files first, so Docker reuses the installed packages until one
# of these changes. npm reads the lockfile with every workspace's package.json.
# No install scripts run, since no package the backend uses needs one, and
# npm's download cache goes, since the image never installs again.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci --workspace backend --omit=dev --ignore-scripts --no-audit --no-fund \
  && npm cache clean --force

# Then the code. Node 24 runs the .ts files as they are: there's no build step.
COPY packages/contracts/src packages/contracts/src
COPY backend/src backend/src
COPY backend/drizzle backend/drizzle

# In a container, localhost is the container's own, so the backend listens on
# every address, for requests from outside it.
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000

# The image's own unprivileged user, not root.
USER node
WORKDIR /app/backend
CMD ["node", "src/server.ts"]
