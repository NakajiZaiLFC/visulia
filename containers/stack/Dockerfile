# Build the patched Vector image first using containers/vector/Dockerfile.
ARG VECTOR_IMAGE=visulia-vector:build
FROM ${VECTOR_IMAGE} AS vector
FROM docker.elastic.co/elasticsearch/elasticsearch:9.4.7@sha256:e083ef4f6b3d5d49115f2893e384d07b94c02c17093f6b7f05e9b2d2821a079c AS elasticsearch
FROM docker.elastic.co/kibana/kibana:9.4.7@sha256:1ae77e774eaeaef348a223fd8f15b9a8a4b676d7919da58014c6dc5ebefaefba AS kibana
FROM node:24-bookworm-slim@sha256:5cbc7caba8c2c0f0bca675d1b61b9f2857e1cf1853c6164ee9dd409501a936e7 AS agent
WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build

FROM tomee:10.2.0-jre21-Temurin-ubuntu-webprofile@sha256:f9d4c47be02afcacadc4e7b2d96b0399206b1f263d526a1c32f36b180b3d29fd
USER root
RUN apt-get update && apt-get install -y --no-install-recommends tini libstdc++6 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=elasticsearch /usr/share/elasticsearch /opt/elasticsearch
COPY --from=kibana /usr/share/kibana /opt/kibana
COPY --from=agent /usr/local/bin/node /usr/local/bin/node
COPY --from=agent /build/dist /opt/visulia/dist
COPY --from=agent /build/package.json /opt/visulia/package.json
COPY --from=vector /usr/local/bin/vector /usr/local/bin/vector
COPY --from=vector /usr/share/doc/vector /usr/share/doc/vector
COPY containers/tomee /opt/visulia/tomee
COPY templates /opt/visulia/templates
RUN ln -s /usr/local/tomee /opt/tomee && chmod -R a+rX /opt/elasticsearch /opt/kibana /usr/local/tomee /opt/visulia && groupadd --gid 10001 visulia && useradd --uid 10001 --gid 10001 --home-dir /work --no-create-home visulia && mkdir /work && chown 10001:10001 /work && chmod 700 /work
ENV HOME=/work
WORKDIR /work
USER 10001:10001
EXPOSE 8081
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/node", "/opt/visulia/dist/src/agent/main.js"]
