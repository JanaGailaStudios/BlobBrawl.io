# BlobBrawl.io — production container
FROM node:22-alpine

# node:sqlite ships with Node 22.13+; Alpine is enough, no native deps needed.
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DB_PATH=/app/data/blobbrawl.db

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "server/index.js"]
