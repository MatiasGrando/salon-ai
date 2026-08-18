CREATE INDEX "Appointment_professionalId_startAt_idx"
ON "Appointment"("professionalId", "startAt");

CREATE INDEX "BusinessHours_businessId_dayOfWeek_idx"
ON "BusinessHours"("businessId", "dayOfWeek");

CREATE INDEX "ProfessionalHours_professionalId_dayOfWeek_idx"
ON "ProfessionalHours"("professionalId", "dayOfWeek");

CREATE INDEX "ScheduleBlock_businessId_professionalId_startAt_idx"
ON "ScheduleBlock"("businessId", "professionalId", "startAt");
