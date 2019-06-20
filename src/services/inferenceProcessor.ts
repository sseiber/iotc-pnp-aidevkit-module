import { service, inject } from 'spryly';
import { Server } from '@hapi/hapi';
import { LoggingService } from './logging';
import { SubscriptionService } from '../services/subscription';
import { DataStreamController } from '../services/dataStreamProcessor';
import { VideoStreamController } from '../services/videoStreamProcessor';
import { IoTCentralService, DeviceEvent, DeviceTelemetry } from '../services/iotcentral';
import { sleep, bind } from '../utils';
import * as _get from 'lodash.get';

const defaultInferenceThreshold: number = 70;
const defaultDetectClass: string = 'person';

@service('inferenceProcessor')
export class InferenceProcessorService {
    @inject('$server')
    private server: Server;

    @inject('logger')
    private logger: LoggingService;

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
    private inferenceThreshold: number = defaultInferenceThreshold;
    private detectClass: string = defaultDetectClass;

    public async init(): Promise<void> {
        this.logger.log(['InferenceProcessor', 'info'], 'initialize');

        this.server.method({ name: 'inferenceProcessor.dataInference', method: this.handleDataInference });
        this.server.method({ name: 'inferenceProcessor.videoFrame', method: this.handleVideoFrame });

        this.inferenceThreshold = Number(this.iotCentral.iotcVisionProperties.inferenceThreshold) || defaultInferenceThreshold;
        this.detectClass = this.iotCentral.iotcVisionProperties.detectClass || defaultDetectClass;
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
                if (_get(inferenceItem, 'display_name') !== 'Negative' && confidence >= this.inferenceThreshold) {
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

            return className || 'Unknown';
        });

        await this.iotCentral.sendInferenceData(
            {
                [DeviceTelemetry.AllDetections]: inference.inferences.length,
                [DeviceTelemetry.Detections]: detectClassCount
            },
            {
                [DeviceEvent.Inference]: classes.join(', ')
            }
        );
    }
}
