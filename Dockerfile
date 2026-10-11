FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY server ./server
COPY public ./public
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5180 DATA_DIR=/data
VOLUME /data
EXPOSE 5180
USER node
CMD ["node", "server.js"]
