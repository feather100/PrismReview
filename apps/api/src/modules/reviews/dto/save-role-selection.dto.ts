import { IsArray, IsUUID, IsInt, Min, Max, ArrayMinSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class RoleWeightItem {
  @IsUUID('4')
  roleId: string;

  @IsInt()
  @Min(0)
  @Max(100)
  weight: number;
}

export class SaveRoleSelectionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RoleWeightItem)
  roles: RoleWeightItem[];
}
