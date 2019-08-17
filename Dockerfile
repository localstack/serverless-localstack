FROM node:6.10

WORKDIR /app
COPY . /app
RUN npm install

ENTRYPOINT '/bin/bash'
