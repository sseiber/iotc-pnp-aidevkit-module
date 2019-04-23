import { service, inject } from 'spryly';
import { spawn } from 'child_process';
import { LoggingService } from './logging';
import { Transform } from 'stream';
import { IoTCentralService, DeviceEvent, MessageType } from '../services/iotcentral';
import { bind, forget } from '../utils';
import * as _get from 'lodash.get';
import { HealthStates } from './serverTypes';

const gstCommand = 'gst-launch-1.0';
const gstCommandArgs = '-q rtspsrc location=###DATA_STREAM_URL protocols=tcp ! application/x-rtp, media=application ! fakesink dump=true';

@service('dataStreamController')
export class DataStreamController {
    @inject('logger')
    private logger: LoggingService;

    @inject('iotCentral')
    private iotCentral: IoTCentralService;

    private handleDataInferenceCallback: any = null;
    private dataStreamUrl: string = '';
    private gstProcess: any = null;
    private restartCount: number = 0;

    public setInferenceCallback(handleInference: any) {
        this.handleDataInferenceCallback = handleInference;
    }

    @bind
    public async startDataStreamProcessor(dataStreamUrl: string): Promise<boolean> {
        this.dataStreamUrl = dataStreamUrl;

        if (!dataStreamUrl) {
            this.logger.log(['DataStreamController', 'warning'], `Not starting inference processor because dataStreamUrl is empty`);
        }

        this.logger.log(['DataStreamController', 'info'], `Starting inference processor`);

        try {
            this.gstProcess = spawn(gstCommand, gstCommandArgs.replace('###DATA_STREAM_URL', dataStreamUrl).split(' '), { stdio: ['ignore', 'pipe', 'ignore'] });

            this.gstProcess.on('error', (error) => {
                this.logger.log(['dataController', 'error'], `Error on gstProcess: ${_get(error, 'message')}`);

                forget(this.iotCentral.sendMeasurement, MessageType.Event, { [DeviceEvent.DataStreamProcessingError]: '1' });

                this.restartController();
            });

            this.gstProcess.on('exit', (code, signal) => {
                this.logger.log(['dataController', 'info'], `Exit on gstProcess, code: ${code}, signal: ${signal}`);

                forget(this.iotCentral.sendMeasurement, MessageType.Event, { [DeviceEvent.DataStreamProcessingStopped]: '0' });

                if (this.gstProcess !== null) {
                    // abnormal exit
                    this.restartController();
                }

                this.gstProcess = null;
            });

            const frameProcessor = new FrameProcessor({});

            frameProcessor.on('inference', (inference: any) => {
                forget(this.handleDataInferenceCallback, inference);
            });

            this.gstProcess.stdout.pipe(frameProcessor);

            forget(this.iotCentral.sendMeasurement, MessageType.Event, { [DeviceEvent.DataStreamProcessingStarted]: '1' });

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
        if (this.restartCount > 5) {
            return HealthStates.Critical;
        }

        return HealthStates.Good;
    }

    private restartController() {
        if (this.restartCount === 0) {
            setTimeout(() => {
                this.restartCount = 0;
            }, (1000 * 120));
        }

        this.restartCount++;

        if (this.gstProcess === null) {
            return;
        }

        this.gstProcess = null;

        this.logger.log(['dataController', 'info'], `Abnormal exit, will attempt to restart in 10sec.`);

        setTimeout(() => {
            forget(this.startDataStreamProcessor, this.dataStreamUrl);
        }, (1000 * 10));
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
