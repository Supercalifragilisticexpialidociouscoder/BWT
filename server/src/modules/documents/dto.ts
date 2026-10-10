import type { DocumentRequirementDTO } from '@campusflow/shared';
import type { IDocumentRequirement } from '../../models';

export function requirementDTO(r: IDocumentRequirement): DocumentRequirementDTO {
  return {
    key: r.key,
    type: r.type,
    name: r.name,
    description: r.description,
    required: r.required,
    appliesTo: r.appliesTo,
    deadline: r.deadline ? r.deadline.toISOString() : null,
    formats: [...r.formats],
    reviewRequired: r.reviewRequired,
    active: r.active,
    template: r.template ? { name: r.template.originalName, size: r.template.size, uploadedAt: r.template.uploadedAt.toISOString() } : null,
  };
}
