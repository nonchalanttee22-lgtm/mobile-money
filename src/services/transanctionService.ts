import { TransactionModel } from "../models/transaction";

export class TransactionService {
  constructor(private txModel: TransactionModel) {}

  async findByUserId(userId: string) {
    return await this.txModel.findByUserId(userId);
  }
}
