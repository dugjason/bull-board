# Fork: builds the CLI from this checkout instead of installing @bull-board/cli from npm, so the
# image carries the overview volume charts.
FROM node:22-alpine AS build

WORKDIR /src
ENV SKIP_INSTALL_SIMPLE_GIT_HOOKS=1
COPY . .
RUN corepack enable \
    && yarn install --immutable \
    && yarn workspaces foreach -Rt --from @bull-board/cli run build

FROM node:22-alpine

ENV NODE_ENV=production \
    BULL_BOARD_HOST=0.0.0.0 \
    BULL_BOARD_OPEN=false

COPY --from=build /src /opt/bull-board
RUN ln -s /opt/bull-board/packages/cli/dist/bin.js /usr/local/bin/bull-board \
    && mkdir -p /app && chown node:node /app

WORKDIR /app
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD \
    node -e "fetch('http://127.0.0.1:'+(process.env.BULL_BOARD_PORT||3000)+'/').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"

ENTRYPOINT ["bull-board"]
