/** Matches AppModel.isOfficial and the API's owner/manager/admin convention. */
export function canExportReports(staff: { is_owner?: boolean; role?: string | null } | null | undefined): boolean {
  return staff?.is_owner === true || staff?.role === 'manager' || staff?.role === 'admin'
}
