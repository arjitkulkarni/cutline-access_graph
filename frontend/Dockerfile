# CUTLINE console (Next.js). The /api rewrite target is compiled into the build, so pass the API URL as a build arg:
#   docker build --build-arg CUTLINE_API_URL=https://api.example.com -t cutline-console frontend
FROM node:24-alpine AS build
WORKDIR /app
ARG CUTLINE_API_URL=http://api:8000
ENV CUTLINE_API_URL=${CUTLINE_API_URL} NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts
EXPOSE 3000
CMD ["sh", "-c", "node node_modules/next/dist/bin/next start -p ${PORT}"]
