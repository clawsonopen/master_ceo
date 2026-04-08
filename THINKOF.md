Ajanlarin ajan yatabilme yetenegi kendi configurasyon sayfalarinda acik dahi olsa bu yeti requireBoardApprovalForNewAgents policy’sine bağlı. bu nedenle “Cannot assign work to pending approval agents” hatası direkt assignee status kontrolünden geliyor: 
[issues.ts](/Users/ozany/Documents/MASTER CEO/paperclip/server/src/services/issues.ts:586)
Pending’e düşme, hire sırasında requireBoardApprovalForNewAgents policy’sine bağlı:
[agents.ts](/Users/ozany/Documents/MASTER CEO/paperclip/server/src/routes/agents.ts:1364)
API key/provider bağlı bir kontrol görünmüyor.
Org tree backend’de terminated hariç agent’ları alıyor (pending dahil):
[agents-service.ts](/Users/ozany/Documents/MASTER CEO/paperclip/server/src/services/agents.ts:676)
