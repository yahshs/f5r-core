import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useUserTickets } from '@/hooks/useApi';

export default function AccountTicketsPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useUserTickets();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('tickets.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('account.title')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('tickets.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !data?.data?.length ? (
            <p className="text-sm text-muted-foreground">{t('tickets.empty')}</p>
          ) : (
            data.data.map((ticket) => (
              <div key={ticket.id} className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">{ticket.subject}</p>
                  <p className="text-xs text-muted-foreground">{ticket.message}</p>
                </div>
                <Badge variant="outline">{ticket.status}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

