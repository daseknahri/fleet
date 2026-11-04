# syntax=docker/dockerfile:1

FROM node:lts-alpine
WORKDIR /bookcars/backend
COPY ./backend ./
COPY ./backend/.env.docker .env
COPY ./packages /bookcars/packages
RUN npm install
# Build at image build time: devDependencies are only guaranteed here,
# and NODE_ENV=production at runtime would make the packages' `npm i` skip them.
RUN npm run build

CMD [ "sh", "-c", "node dist/src/setup/setup.js && node --import ./dist/src/monitoring/instrument.js dist/src" ]
EXPOSE 4002
