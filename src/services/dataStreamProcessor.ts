import { service, inject } from '@sseiber/sprightly';
import { Server } from 'hapi';
import { spawn } from 'child_process';
import { LoggingService } from './logging';
import * as _get from 'lodash.get';
import { Transform } from 'stream';

const gstCommand = 'gst-launch-1.0';
const gstCommandArgs = '-q rtspsrc location=###DATA_STREAM_URL protocols=tcp ! application/x-rtp, media=application ! fakesink dump=true';

@service('dataStreamController')
export class DataStreamController {
    @inject('$server')
    private server: Server;

    @inject('logger')
    private logger: LoggingService;

    private gstProcess = null;

    public async startDataStreamProcessor(dataStreamUrl: string): Promise<boolean> {
        this.logger.log(['DataStreamController', 'info'], `Starting capture processes`);

        try {
            this.gstProcess = spawn(gstCommand, gstCommandArgs.replace('###DATA_STREAM_URL', dataStreamUrl).split(' '), { stdio: ['ignore', 'pipe', 'ignore'] });

            this.gstProcess.on('error', (error) => {
                this.logger.log(['dataController', 'error'], `Error on gstProcess: ${error}`);
                this.gstProcess = null;
            });

            this.gstProcess.on('exit', (code, signal) => {
                this.logger.log(['dataController', 'info'], `Exit on gstProcess, code: ${code}, signal: ${signal}`);
                this.gstProcess = null;
            });

            const frameProcessor = new FrameProcessor({});

            frameProcessor.on('inference', async (inference: any) => {
                const inferences = _get(inference, 'objects');
                if (inferences && Array.isArray(inferences)) {
                    for (const inferenceItem of inferences) {
                        this.logger.log(['DataStreamController', 'info'], `Inference: `
                            + `id:${_get(inferenceItem, 'id')} `
                            + `"${_get(inferenceItem, 'display_name')}" `
                            + `${_get(inferenceItem, 'confidence')}% `);

                        this.server.publish(`/api/v1/inference`, inferenceItem);
                    }
                }
            });

            this.gstProcess.stdout.pipe(frameProcessor);

            return true;
        }
        catch (e) {
            this.logger.log(['dataController', 'error'], e.message);

            return false;
        }
    }

    public stopDataStreamProcessor() {
        if (!this.gstProcess) {
            return;
        }

        const process = this.gstProcess;
        this.gstProcess = null;

        process.exit(1);

        return;
    }

    public testInference(testInference: any) {
        this.server.publish(`/api/v1/inference`, testInference);
    }
}

const chunkHeader0 = '00000000';
const startOfInference = '{ "t';

class FrameProcessor extends Transform {
    private inferenceLines: any[];

    constructor(options) {
        super(options);

        this.inferenceLines = [];
    }

    // @ts-ignore (encoding)
    public _transform(chunk: Buffer, encoding: string, done: callback) {
        const chunkString = chunk.toString('utf8');
        if (chunkString.substring(0, 8) !== chunkHeader0) {
            const chunkLines = chunkString.split('\n');
            for (const chunkLine of chunkLines) {
                this.inferenceLines.push(chunkLine.substring(74).trim());
            }

            try {
                const inference = JSON.parse(this.inferenceLines.join(''));

                if ((this as any)._readableState.pipesCount > 0) {
                    this.push(inference);
                }

                if (this.listenerCount('inference') > 0) {
                    this.emit('inference', inference);
                }
            }
            catch (ex) {
                // tslint:disable no-console variable-name
                console.log(`Malformed inference data: ${this.inferenceLines.join('')}`);
            }

            this.inferenceLines = [];
        }
        else {
            const startIndex = chunkString.indexOf(startOfInference);
            if (startIndex !== -1) {
                this.inferenceLines.push(startOfInference);

                const chunkLines = chunkString.substring(92).split('\n');
                for (const chunkLine of chunkLines) {
                    if (chunkLine.substring(0, 8) !== chunkHeader0) {
                        this.inferenceLines.push(chunkLine.substring(74).trim());
                    }
                }
            }
        }

        return done();
    }
}
