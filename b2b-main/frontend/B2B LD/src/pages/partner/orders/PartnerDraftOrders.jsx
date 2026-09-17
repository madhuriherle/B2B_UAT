import OrderListView from "./OrderListView";

const PartnerDraftOrders = () => (
  <OrderListView
    title="Draft Orders"
    subtitle="Orders saved but not yet submitted"
    statuses={["Draft"]}
    emptyText="No draft orders"
  />
);

export default PartnerDraftOrders;
