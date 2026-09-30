FROM node:22-slim
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Sao chép mã nguồn (được lọc qua .dockerignore)
COPY . .

# Cài đặt toàn bộ dependencies trong workspace
RUN pnpm install --frozen-lockfile

ENV PORT=2567
ENV NODE_ENV=production
EXPOSE 2567

CMD ["pnpm", "--filter", "@tentides/server", "start"]
