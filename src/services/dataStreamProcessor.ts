import { service, inject } from 'spryly';
import { Server } from '@hapi/hapi';
import { spawn } from 'child_process';
import { LoggingService } from './logging';
import { Transform } from 'stream';
import { IoTCentralService, PeabodyDeviceFieldIds } from '../services/iotcentral';
import { forget } from '../utils';
import * as _get from 'lodash.get';
import { HealthState } from './health';

const gstCommand = 'gst-launch-1.0';
const gstCommandArgs = '-q rtspsrc location=###DATA_STREAM_URL protocols=tcp ! application/x-rtp, media=application ! fakesink dump=true';

@service('dataStreamController')
export class DataStreamController {
    @inject('$server')
    private server: Server;

    @inject('logger')
    private logger: LoggingService;

    @inject('iotCentral')
    private iotCentral: IoTCentralService;

    private gstProcess: any = null;
    private healthState: number = HealthState.Good;

    public async startDataStreamProcessor(dataStreamUrl: string): Promise<boolean> {
        if (!dataStreamUrl) {
            this.logger.log(['DataStreamController', 'warning'], `Not starting inference processor because dataStreamUrl is empty`);
        }

        this.logger.log(['DataStreamController', 'info'], `Starting inference processor`);

        try {
            this.gstProcess = spawn(gstCommand, gstCommandArgs.replace('###DATA_STREAM_URL', dataStreamUrl).split(' '), { stdio: ['ignore', 'pipe', 'ignore'] });

            this.gstProcess.on('error', (error) => {
                this.logger.log(['dataController', 'error'], `Error on gstProcess: ${_get(error, 'message')}`);

                forget(this.iotCentral.sendMeasurement, { [PeabodyDeviceFieldIds.Event.DataStreamProcessingError]: _get(error, 'message') });

                this.healthState = HealthState.Critical;
            });

            this.gstProcess.on('exit', (code, signal) => {
                this.logger.log(['dataController', 'info'], `Exit on gstProcess, code: ${code}, signal: ${signal}`);

                forget(this.iotCentral.sendMeasurement, { [PeabodyDeviceFieldIds.Event.DataStreamProcessingStopped]: '1' });

                if (this.gstProcess !== null) {
                    // abnormal exit
                    this.healthState = HealthState.Warning;
                }

                this.gstProcess = null;
            });

            const frameProcessor = new FrameProcessor({});

            frameProcessor.on('inference', (inference: any) => {
                forget((this.server.methods.inferenceProcessor as any).dataInference, inference);
            });

            this.gstProcess.stdout.pipe(frameProcessor);

            forget(this.iotCentral.sendMeasurement, { [PeabodyDeviceFieldIds.Event.DataStreamProcessingStarted]: '1' });

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

        process.kill();

        return;
    }

    public getHealth(): number {
        return this.healthState;
    }
}

const chunkHeader0 = '00000000';
const inferenceHeader = '{ "t';
const transformStateLookingForHeader = 'WH';
const transformStateParsingInference = 'PI';

class FrameProcessor extends Transform {
    private transformState: string;
    private inferenceLines: any[];

    constructor(options) {
        super(options);

        this.transformState = transformStateLookingForHeader;
        this.inferenceLines = [];
    }

    // @ts-ignore (encoding)
    public _transform(chunk: Buffer, encoding: string, done: callback) {
        let chunkIndex = 0;
        const chunkBufferString = chunk.toString('utf8');

        while (chunkIndex < chunkBufferString.length) {
            const chunkString = chunkBufferString.slice(chunkIndex);

            const chunkLines = chunkString.split('\n');
            for (const chunkLine of chunkLines) {
                if (this.transformState === transformStateLookingForHeader) {
                    const lineIndex = chunkLine.indexOf(inferenceHeader);
                    if (lineIndex !== -1) {
                        this.transformState = transformStateParsingInference;

                        this.inferenceLines.push(chunkLine.slice(lineIndex).trim());
                    }
                }
                else if (this.transformState === transformStateParsingInference) {
                    if (chunkLine.slice(0, 8) === chunkHeader0) {
                        this.emitInference(chunkString);

                        this.transformState = transformStateLookingForHeader;
                        break;
                    }

                    this.inferenceLines.push(chunkLine.slice(-16).trim());
                }

                chunkIndex += chunkLine.length + 1;
            }
        }

        return done();
    }

    private emitInference(chunkString: string): boolean {
        let result = true;
        const inferenceTextData = this.inferenceLines.join('');
        try {
            const inference = JSON.parse(inferenceTextData);

            if ((this as any)._readableState.pipesCount > 0) {
                this.push(inference);
            }

            if (this.listenerCount('inference') > 0) {
                this.emit('inference', inference);
            }
        }
        catch (ex) {
            // tslint:disable no-console variable-name
            console.log(`##Inference parse exception: ${inferenceTextData}`);

            // tslint:disable no-console variable-name
            console.log(`##Raw: ${chunkString}`);

            result = false;
        }

        this.inferenceLines = [];

        return result;
    }
}
