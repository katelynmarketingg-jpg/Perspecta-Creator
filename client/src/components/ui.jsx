import {
  Box, Card, CardContent, Typography, Stack, Skeleton,
  Table, TableBody, TableCell, TableRow,
} from "@mui/material";
import { alpha } from "@mui/material/styles";

export function PageHeader({ title, subtitle, action }) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3, flexWrap: "wrap", gap: 1.5 }}>
      <Box>
        <Typography variant="h5">{title}</Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {action}
    </Stack>
  );
}

export function StatCard({ label, value, icon }) {
  return (
    <Card sx={{ height: "100%" }}>
      <CardContent sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        {icon && (
          <Box
            sx={{
              width: 46, height: 46, borderRadius: 2.5,
              bgcolor: (t) => alpha(t.palette.primary.main, 0.14),
              color: "primary.main",
              display: "grid", placeItems: "center",
            }}
          >
            {icon}
          </Box>
        )}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" sx={{ lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
            {value ?? <Skeleton width={72} />}
          </Typography>
          <Typography variant="body2" color="text.secondary">{label}</Typography>
        </Box>
      </CardContent>
    </Card>
  );
}

// Skeleton em forma de linhas de tabela — evita o "flash" de tela vazia.
export function TableSkeleton({ rows = 4, cols = 4 }) {
  return (
    <Card>
      <Table>
        <TableBody>
          {Array.from({ length: rows }).map((_, r) => (
            <TableRow key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <TableCell key={c}>
                  <Skeleton width={c === 0 ? "70%" : "50%"} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

// Skeleton em forma de card do kanban.
export function CardSkeleton() {
  return (
    <Card>
      <CardContent sx={{ p: 1.75, "&:last-child": { pb: 1.75 } }}>
        <Skeleton width="75%" />
        <Skeleton width="45%" />
        <Stack direction="row" spacing={0.5} sx={{ mt: 1 }}>
          <Skeleton variant="rounded" width={56} height={22} />
          <Skeleton variant="rounded" width={72} height={22} />
        </Stack>
      </CardContent>
    </Card>
  );
}

export function EmptyState({ message, action }) {
  return (
    <Card>
      <CardContent sx={{ textAlign: "center", py: 6 }}>
        <Typography color="text.secondary" sx={{ mb: action ? 2 : 0 }}>{message}</Typography>
        {action}
      </CardContent>
    </Card>
  );
}
