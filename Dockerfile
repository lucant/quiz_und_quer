FROM node:24.13.1-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir /data && chown node:node /data
COPY --chown=node:node server.js ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
