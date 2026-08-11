import { z } from "zod";
import { DATE_RE, isValidCalendarDate } from "./core/dates.js";

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

export const dateString = z
  .string()
  .regex(DATE_RE, "Date must be in YYYY-MM-DD format")
  .refine(isValidCalendarDate, "Date must be a real calendar date");

export const responseFormat = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable");

export const entryOutputShape = {
  date: z.string(),
  slug: z.string(),
  title: z.string(),
  path: z.string(),
  category: z.string(),
};
