import { IsOptional, IsString } from "class-validator";

export class UpdateListingDto {
	@IsString()
	@IsOptional()
	title?: string;

	@IsString()
	@IsOptional()
	category?: string;

	@IsString()
	@IsOptional()
	grade?: string;

	@IsString()
	@IsOptional()
	unit?: string;

	@IsString()
	@IsOptional()
	stock?: string;

	@IsString()
	@IsOptional()
	price?: string;

	@IsString()
	@IsOptional()
	brand?: string;

	@IsString()
	@IsOptional()
	description?: string;
}