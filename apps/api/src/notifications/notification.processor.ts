import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { NotificationQueueService } from "./notification.queue";
import { NotificationService } from "./notification.service";
import { NOTIFICATIONS_QUEUE_NAME, NotificationJobData } from "./notification.types";

@Injectable()
export class NotificationProcessor implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<NotificationJobData> | null = null;

  constructor(
    private readonly queueService: NotificationQueueService,
    private readonly notificationService: NotificationService
  ) {}

  onModuleInit() {
    const connection = this.queueService.getConnection();
    if (!connection) {
      return;
    }

    this.worker = new Worker<NotificationJobData>(
      NOTIFICATIONS_QUEUE_NAME,
      async (job) => {
        await this.notificationService.processNotification(job.data.notificationId, job.attemptsMade + 1, job.opts.attempts ?? 3);
      },
      {
        connection,
        concurrency: 2,
      }
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
    this.worker = null;
  }
}