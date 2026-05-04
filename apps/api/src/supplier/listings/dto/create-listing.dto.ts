import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateListingDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  category!: string;

  @IsString()
  @IsOptional()
  grade?: string;

  @IsString()
  @IsNotEmpty()
  unit!: string;

  @IsString()
  @IsNotEmpty()
  stock!: string;

  @IsString()
  @IsNotEmpty()
  price!: string;

  @IsString()
  @IsOptional()
  brand?: string;

  @IsString()
  @IsOptional()
  description?: string;
}