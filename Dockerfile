FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY server.mjs ./
COPY .env.example ./
RUN mkdir -p /app/data

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.mjs"]
