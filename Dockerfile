# Two-stage build, same private ECR ARM base image as the sibling
# gyftr-portal/gyftr-legal frontends. This app has no frontend/ subfolder —
# the Vite project lives at repo root — so this Dockerfile builds from ".".
FROM 653380732738.dkr.ecr.ap-south-1.amazonaws.com/node-24.18.0-alpine3.24-arm:node-24.18.0-alpine3.24-arm AS build
WORKDIR /app
COPY package.json package-lock.json* ./
# The base image bakes NODE_ENV=production, which would skip devDependencies
# (vite, typescript, etc.) — override it just for this install.
RUN NODE_ENV=development npm ci --include=dev
COPY . .
ARG VITE_API_URL
ARG VITE_COGNITO_USER_POOL_ID
ARG VITE_COGNITO_CLIENT_ID
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_COGNITO_USER_POOL_ID=$VITE_COGNITO_USER_POOL_ID
ENV VITE_COGNITO_CLIENT_ID=$VITE_COGNITO_CLIENT_ID
RUN npm run build

FROM 653380732738.dkr.ecr.ap-south-1.amazonaws.com/node-24.18.0-alpine3.24-arm:node-24.18.0-alpine3.24-arm
WORKDIR /app
RUN npm install -g serve@14
COPY --from=build /app/dist ./dist
EXPOSE 4173
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:4173').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Bind explicitly to 0.0.0.0 — inside a container `serve` can otherwise
# silently bind to localhost only, which passes local testing but fails
# every ALB/ECS health check with no obvious error.
# -s rewrites unknown paths to index.html; harmless here (no client router)
# but keeps this Dockerfile identical in shape to the sibling frontends'.
CMD ["serve", "-s", "dist", "-l", "tcp://0.0.0.0:4173"]
