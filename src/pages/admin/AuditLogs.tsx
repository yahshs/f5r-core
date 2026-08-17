import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAdminAuditLogs } from '@/hooks/useApi';

export default function AdminAuditLogsPage() {
  const { t } = useTranslation();
  const logsQuery = useAdminAuditLogs(200);
  const logs = logsQuery.data?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('admin.auditLogs')}</h1>
        <p className="text-sm text-muted-foreground">{t('admin.auditLogsSubtitle')}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.auditLogs')}</CardTitle>
          <CardDescription>{t('admin.auditLogsHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {logsQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('common.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('admin.auditLogsActor')}</TableHead>
                    <TableHead>{t('admin.auditLogsAction')}</TableHead>
                    <TableHead>{t('admin.auditLogsEntity')}</TableHead>
                    <TableHead>{t('admin.auditLogsWhen')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">{log.actor_name ?? log.actor_id}</p>
                          <p className="text-xs text-muted-foreground">{log.actor_email ?? log.actor_role}</p>
                        </div>
                      </TableCell>
                      <TableCell>{log.action}</TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm">{log.entity_type}</p>
                          <p className="text-xs text-muted-foreground">{log.entity_id}</p>
                        </div>
                      </TableCell>
                      <TableCell>{new Date(log.created_at).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
