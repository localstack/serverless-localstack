FROM node:6.10

WORKDIR /app
COPY . /app
RUN yarn install

ENTRYPOINT '/bin/bash'
