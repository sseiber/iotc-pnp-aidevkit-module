FROM arm32v7/node:10-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    net-tools \
    unzip \
    && apt-get install -y --no-install-recommends \
    libgstreamer1.0 \
    gstreamer1.0-plugins-base \
    gstreamer1.0-plugins-good \
    gstreamer1.0-libav \
    gstreamer1.0-tools \
    && rm -rf /var/lib/apt/lists/*

ENV WORKINGDIR /app
WORKDIR ${WORKINGDIR}

ADD THIRDPARTYNOTICE.TXT ${WORKINGDIR}/THIRDPARTYNOTICE.TXT
ADD package.json ${WORKINGDIR}/package.json
ADD tslint.json ${WORKINGDIR}/tslint.json
ADD tsconfig.json ${WORKINGDIR}/tsconfig.json
ADD src ${WORKINGDIR}/src
ADD client_dist ${WORKINGDIR}/client_dist
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
