import { ExpressAdapter } from "@bull-board/express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/dist/queueAdapters/bullMQ";
import { transactionQueue } from "./transactionQueue";
import { deadLetterQueue } from "./dlq";

const createQueueAdapter = (queue: any) => {
  return new BullMQAdapter(queue, {
    readOnlyMode: false,
  });
};

export function createQueueDashboard() {
  const serverAdapter = new ExpressAdapter();

  createBullBoard({
    queues: [
      createQueueAdapter(transactionQueue),
      createQueueAdapter(deadLetterQueue),
    ],
    serverAdapter: serverAdapter,
    options: {
      uiConfig: {
        boardTitle: "Mobile Money Queue Dashboard",
      },
    },
  });

  serverAdapter.setBasePath("/admin/queues");

  return serverAdapter.getRouter();
}
