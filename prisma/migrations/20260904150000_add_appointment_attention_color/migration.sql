CREATE TYPE "AppointmentAttentionColor" AS ENUM ('NONE', 'YELLOW', 'ORANGE');

ALTER TABLE "Appointment"
ADD COLUMN "attentionColor" "AppointmentAttentionColor" NOT NULL DEFAULT 'NONE';
