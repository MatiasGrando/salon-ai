UPDATE "Campaign"
SET
  "stopOnBooking" = true,
  "stopOnReply" = true,
  "restartAfterVisit" = true
WHERE
  "stopOnBooking" = false
  OR "stopOnReply" = false
  OR "restartAfterVisit" = false;
