FROM oven/bun:1.2-alpine

# Install Docker CLI in worker container to allow managing runner sandboxes
RUN apk add --no-cache docker-cli

WORKDIR /app

# Copy dependency definitions
COPY package.json bun.lock* ./
RUN bun install

# Copy backend source
COPY . .

# Generate Prisma client
RUN bunx prisma generate

EXPOSE 3000 3001

CMD ["bun", "index.ts"]
