export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  timestamp: Date;
}

export const auditService = {
  fetchAuditLogs: async (userId: string) => {
    //TODO Needs implementation

    return [
      {
        id: userId,
        userId: userId,
        action: "",
        timestamp: new Date(),
      },
    ];
  },
  updateAuditLog: async (log: AuditLog) => {
    //TODO Needs implementation
    throw new Error("Not yet implmented");
  },
};
