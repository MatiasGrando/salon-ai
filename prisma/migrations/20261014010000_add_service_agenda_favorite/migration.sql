-- Favorites are shared within a business and only affect Agenda option ordering.
ALTER TABLE "Service" ADD COLUMN "agendaFavorite" BOOLEAN NOT NULL DEFAULT false;
