import { service, inject } from 'spryly';
import { LoggingService } from './logging';
import { SubscriptionService } from '../services/subscription';
import * as _get from 'lodash.get';

@service('inferenceProcessor')
export class InferenceProcessorService {
    @inject('logger')
    private logger: LoggingService;

    @inject('subscription')
    private subscription: SubscriptionService;

    private inferenceCount: number = 0;
    private lastImageData: Buffer = null;

    public handleDataInference(inference: any) {
        const inferences = _get(inference, 'objects');

        if (inferences && Array.isArray(inferences)) {
            for (const inferenceItem of inferences) {
                this.logger.log(['DataStreamController', 'info'], `Inference: `
                    + `id:${_get(inferenceItem, 'id')} `
                    + `"${_get(inferenceItem, 'display_name')}" `
                    + `${_get(inferenceItem, 'confidence')}% `);
            }

            this.publishInference({
                timestamp: inference.timestamp,
                objects: inference.objects.map((object) => {
                    return {
                        count: this.inferenceCount++,
                        ...object
                    }
                })
            });
        }
    }

    public handleVideoFrame(imageData: Buffer) {
        this.lastImageData = Buffer.from(imageData);
    }

    private publishInference(inference) {
        this.subscription.publishInference({
            inference,
            imageData: this.lastImageData
        });
    }
}
