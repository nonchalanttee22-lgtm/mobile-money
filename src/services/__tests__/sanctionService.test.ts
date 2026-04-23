import { sanctionService } from "../sanctionService";
import { pool } from "../../config/database";

// Mock the pool.query and pool.connect
jest.mock("../../config/database", () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

describe("SanctionService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("jaroWinkler", () => {
    it("should return 1.0 for exact matches", () => {
      const score = (sanctionService as any).jaroWinkler("OSAMA BIN LADEN", "OSAMA BIN LADEN");
      expect(score).toBe(1.0);
    });

    it("should return 0.0 for completely different strings", () => {
      const score = (sanctionService as any).jaroWinkler("ABC", "XYZ");
      expect(score).toBe(0.0);
    });

    it("should return a high score for similar names", () => {
      const score = (sanctionService as any).jaroWinkler("Osama bin Laden", "Usama bin Laden");
      expect(score).toBeGreaterThan(0.9);
    });

    it("should return a lower score for less similar names", () => {
      const score = (sanctionService as any).jaroWinkler("John Doe", "Jane Doe");
      expect(score).toBeGreaterThan(0.8);
      expect(score).toBeLessThan(0.95);
    });
  });

  describe("searchSanctions", () => {
    it("should return matches above threshold", async () => {
      (pool.query as jest.fn).mockResolvedValue({
        rows: [
          { name: "Osama bin Laden", country: "Saudi Arabia", source: "UN", category: "Individual", external_id: "UN-001" },
          { name: "John Doe", country: "USA", source: "OFAC", category: "Individual", external_id: "OFAC-123" },
        ],
      });

      const matches = await sanctionService.searchSanctions("Usama bin Laden", 0.85);
      expect(matches.length).toBe(1);
      expect(matches[0].entity.name).toBe("Osama bin Laden");
      expect(matches[0].score).toBeGreaterThan(0.9);
    });

    it("should return empty array if no matches above threshold", async () => {
      (pool.query as jest.fn).mockResolvedValue({
        rows: [
          { name: "Osama bin Laden", country: "Saudi Arabia", source: "UN", category: "Individual", external_id: "UN-001" },
        ],
      });

      const matches = await sanctionService.searchSanctions("Santa Claus", 0.85);
      expect(matches.length).toBe(0);
    });
  });

  describe("updateSanctionList", () => {
    it("should execute batch updates within a transaction", async () => {
      const mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };
      (pool.connect as jest.fn).mockResolvedValue(mockClient);

      const entities = [
        { name: "Entity 1", source: "UN", external_id: "E1" },
        { name: "Entity 2", source: "UN", external_id: "E2" },
      ];

      await sanctionService.updateSanctionList(entities);

      expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO sanction_list"), expect.any(Array));
      expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
      expect(mockClient.release).toHaveBeenCalled();
    });

    it("should rollback on error", async () => {
      const mockClient = {
        query: jest.fn().mockImplementation((q) => {
          if (q.includes("INSERT")) throw new Error("DB Error");
        }),
        release: jest.fn(),
      };
      (pool.connect as jest.fn).mockResolvedValue(mockClient);

      await expect(sanctionService.updateSanctionList([{ name: "E1", source: "UN", external_id: "E1" }]))
        .rejects.toThrow("DB Error");

      expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
