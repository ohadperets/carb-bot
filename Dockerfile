FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ARG GH_SYNC_TOKEN
ENV GH_SYNC_TOKEN=${GH_SYNC_TOKEN}

CMD ["node", "src/index.js"]
