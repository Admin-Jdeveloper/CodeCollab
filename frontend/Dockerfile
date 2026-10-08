FROM oven/bun:1.2-alpine

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

EXPOSE 3003

CMD ["bun", "run", "start"]
