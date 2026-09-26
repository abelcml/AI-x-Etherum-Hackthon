FROM node:22.18.0-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.0.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm compile && pnpm test
CMD ["pnpm", "check"]
