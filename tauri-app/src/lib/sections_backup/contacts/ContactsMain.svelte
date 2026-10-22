<script lang="ts">
  import * as Card from "$lib/components/ui/card/index.js";
</script>

<div class="p-6 max-w-md mx-auto w-full h-full overflow-y-auto">
  <h2 class="text-2xl font-bold text-primary mb-6">Contact Details</h2>

  <Card.Root class="border-border shadow-sm mb-6">
    <Card.Header class="bg-secondary rounded-t-lg border-b border-border">
      <Card.Title class="text-primary">Send Contact Request</Card.Title>
      <Card.Description class="text-muted-foreground">Enter a public key to connect</Card.Description>
    </Card.Header>
    <Card.Content class="space-y-4 pt-4">
      <input
        type="text"
        placeholder="0x..."
        class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
      />
      <button class="w-full bg-primary text-primary-foreground h-10 rounded-md font-medium hover:bg-primary/90 transition-colors">
        Send Request
      </button>
    </Card.Content>
  </Card.Root>

  <div class="p-4 border border-border rounded-lg bg-secondary">
    <p class="text-sm text-muted-foreground italic">Pending requests and contact info will appear here.</p>
  </div>
</div>
