FROM oven/bun:1
WORKDIR /usr/src/app

COPY bun.lockb .
COPY package.json .
RUN bun install --frozen-lockfile --production --ignore-scripts --no-cache && bun pm cache clean

COPY scripts ./scripts
COPY src ./src
COPY tsconfig.json .
RUN bun run postinstall

EXPOSE 3000/tcp
ENTRYPOINT [ "bun", "run", "start" ]