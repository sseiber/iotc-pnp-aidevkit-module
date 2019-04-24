import { service, inject } from 'spryly';
import { Server } from 'hapi';
import { LoggingService } from './logging';
import { ConfigService } from './config';
import { SubscriptionService } from '../services/subscription';
import { DataStreamController } from '../services/dataStreamProcessor';
import { VideoStreamController } from '../services/videoStreamProcessor';
import { IoTCentralService, DeviceEvent, MessageType, DeviceSetting, DeviceTelemetry } from '../services/iotcentral';
import { sleep, bind } from '../utils';
import * as _get from 'lodash.get';

const defaultConfidenceThreshold: number = 70;

@service('inferenceProcessor')
export class InferenceProcessorService {
    @inject('$server')
    private server: Server;

    @inject('logger')
    private logger: LoggingService;

    @inject('config')
    private config: ConfigService;

    @inject('subscription')
    private subscription: SubscriptionService;

    @inject('dataStreamController')
    private dataStreamController: DataStreamController;

    @inject('videoStreamController')
    private videoStreamController: VideoStreamController;

    @inject('iotCentral')
    private iotCentral: IoTCentralService;

    private inferenceCount: number = 0;
    private lastImageData: Buffer = null;
    private confidenceThreshold: number = defaultConfidenceThreshold;
    private detectClass: string = 'person';

    public async init(): Promise<void> {
        this.logger.log(['InferenceProcessor', 'info'], 'initialize');

        this.server.method({ name: 'inferenceProcessor.inferenceSettingChange', method: this.handleInferenceSettingChange });
        this.server.method({ name: 'inferenceProcessor.dataInference', method: this.handleDataInference });
        this.server.method({ name: 'inferenceProcessor.videoFrame', method: this.handleDataInference });

        this.confidenceThreshold = Number(this.config.get('confidenceThreshold')) || defaultConfidenceThreshold;
    }

    public async startInferenceProcessor(rtspDataUrl: string, rtspVideoUrl: string) {
        let result = await this.dataStreamController.startDataStreamProcessor(rtspDataUrl);

        if (result === true) {
            result = await this.videoStreamController.startVideoStreamProcessor(rtspVideoUrl);
        }

        return result;
    }

    public stopInferenceProcessor() {
        this.videoStreamController.stopVideoStreamProcessor();
        this.dataStreamController.stopDataStreamProcessor();
    }

    @bind
    public async handleDataInference(inference: any) {
        const inferences = _get(inference, 'objects');

        if (inferences && Array.isArray(inferences)) {
            for (const inferenceItem of inferences) {
                if (_get(inferenceItem, 'display_name') !== 'Negative') {
                    this.logger.log(['InferenceProcessor', 'info'], `Inference: `
                        + `id:${_get(inferenceItem, 'id')} `
                        + `"${_get(inferenceItem, 'display_name')}" `
                        + `${_get(inferenceItem, 'confidence')}% `);
                }
            }

            const publishedInferences = inferences.reduce((publishedItems, inferenceItem) => {
                const confidence = Number(_get(inferenceItem, 'confidence') || 0);
                if (_get(inferenceItem, 'display_name') !== 'Negative' && confidence >= this.confidenceThreshold) {
                    publishedItems.push({
                        count: this.inferenceCount++,
                        ...inferenceItem
                    });
                }

                return publishedItems;
            }, []);

            if (publishedInferences.length > 0) {
                await this.publishInference({
                    timestamp: Date.now(),
                    inferences: publishedInferences
                });
            }
        }
    }

    @bind
    public async handleVideoFrame(imageData: Buffer) {
        this.lastImageData = imageData;
    }

    public async getHealth(): Promise<number[]> {
        return [
            this.dataStreamController.getHealth(),
            this.videoStreamController.getHealth()
        ];
    }

    @bind
    private async handleInferenceSettingChange(setting: string, value: any): Promise<any> {
        this.logger.log(['InferenceProcessor', 'info'], `Handle setting change for ${setting}: ${value}`);

        const result = {
            value,
            status: 'completed'
        };

        switch (setting) {
            case DeviceSetting.InferenceThreshold:
                this.confidenceThreshold = value;
                break;

            case DeviceSetting.DetectClass:
                this.detectClass = value;
                break;

            default:
                this.logger.log(['InferenceProcessor', 'info'], `Unknown setting change request ${setting}`);
                result.status = 'error';
        }

        return result;
    }

    private async publishInference(inference): Promise<void> {
        const trackTimeout = Date.now();
        this.lastImageData = null;
        while ((Date.now() - trackTimeout) < (1000 * 5) && this.lastImageData === null) {
            await sleep(10);
        }

        this.subscription.publishInference({
            inference,
            imageData: this.lastImageData || Buffer.from('')
        });

        let detectClassCount = 0;
        const classes = inference.inferences.map(inferenceItem => {
            const className = _get(inferenceItem, 'display_name');

            if (className === this.detectClass) {
                detectClassCount++;
            }

            return className || 'Unkonwn';
        });

        await this.iotCentral.sendMeasurement(MessageType.Telemetry, { [DeviceTelemetry.AllDetections]: inference.inferences.length });
        await this.iotCentral.sendMeasurement(MessageType.Telemetry, { [DeviceTelemetry.Detections]: detectClassCount });
        await this.iotCentral.sendMeasurement(MessageType.Event, { [DeviceEvent.Inference]: classes.join(', ') });
    }
}
