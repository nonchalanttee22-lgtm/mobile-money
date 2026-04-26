try {
  const filters = parseTransactionExportFilters(req.query);
  const scopedUserId = getScopedUserId(req);

  if (scopedUserId) {
    filters.userId = scopedUserId;
  }

  const { text, values } = buildTransactionExportQuery(filters);

  client = await db.connect();
  const queryStream = createQueryStream(text, values);
  const rowStream = client.query(queryStream);

  const format = req.query.format === "json" ? "json" : "csv";
  const filename = `transactions-${new Date().toISOString().slice(0, 10)}.${format}`;

  res.status(200);
  res.setHeader(
    "Content-Type",
    format === "json" ? "application/json" : "text/csv; charset=utf-8",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"`,
  );

  let transform: Transform;

  if (format === "csv") {
    res.write(`${CSV_HEADERS.join(",")}\n`);
    transform = new Transform({
      objectMode: true,
      transform(chunk: Record<string, unknown>, _encoding, callback) {
        callback(null, transactionRowToCsv(chunk));
      },
    });
  } else {
    let first = true;
    res.write("[\n");
    transform = new Transform({
      objectMode: true,
      transform(chunk: Record<string, unknown>, _encoding, callback) {
        const data =
          (first ? "" : ",\n") + JSON.stringify(chunk, null, 2);
        first = false;
        callback(null, data);
      },
      flush(callback) {
        res.write("\n]");
        callback();
      },
    });
  }

  res.on("close", () => {
    if ("destroy" in rowStream && typeof rowStream.destroy === "function") {
      rowStream.destroy();
    }
    releaseClient();
  });

  pipeline(rowStream, transform, res, (error) => {
    releaseClient();
    if (error) {
      console.error("Transaction export pipeline failed:", error);
    }
  });
}