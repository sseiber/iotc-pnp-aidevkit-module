FROM node:10

RUN apt-get update && apt-get install -y \
    libgstreamer1.0 \
    gstreamer1.0-plugins-base \
    gstreamer1.0-plugins-good \
    gstreamer1.0-libav \
    gstreamer1.0-tools \
    rm -rf /var/lib/apt/lists/*

ENV WORKINGDIR /app
WORKDIR ${WORKINGDIR}
 
ADD package.json ${WORKINGDIR}/package.json
ADD tslint.json ${WORKINGDIR}/tslint.json
ADD tsconfig.json ${WORKINGDIR}/tsconfig.json
ADD src ${WORKINGDIR}/src
ADD .npmrc ${WORKINGDIR}/.npmrc

RUN npm install -q && \
    ./node_modules/.bin/tsc -p . && \
    ./node_modules/.bin/tslint -p . && \
    npm prune --production && \
    rm -f tslint.json && \
    rm -f tsconfig.json && \
    rm -f .npmrc && \
    rm -rf src

EXPOSE 9010

CMD ["node", "./dist/index"]
