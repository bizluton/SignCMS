FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.mjs ./

# Run as non-root
RUN addgroup -S signcms && adduser -S signcms -G signcms
USER signcms

CMD ["node", "index.mjs"]
