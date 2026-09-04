# Same private ECR base image + ARM (Graviton) target as the sibling
# gyftr-portal/gyftr-legal backends — keeps all three on one known-good
# Node/Alpine combination instead of drifting on independent `node:*` tags.
FROM 653380732738.dkr.ecr.ap-south-1.amazonaws.com/node-24.18.0-alpine3.24-arm:node-24.18.0-alpine3.24-arm
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
ENV PORT=4000
ENV AWS_SECRET_NAME=gyftr/tech-portal/db
EXPOSE 4000
# Env vars (DB_*, COGNITO_*, FRONTEND_URL, AWS_SECRET_NAME, etc.) are
# injected at runtime by the ECS task definition — never bake secrets
# into the image.
CMD ["node", "server.js"]
