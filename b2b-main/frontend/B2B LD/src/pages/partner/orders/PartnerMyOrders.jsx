import OrderListView from "./OrderListView";

const PartnerMyOrders = () => (
  <OrderListView
    title="My Orders"
    subtitle="All orders submitted by you"
    statuses={["Submitted", "In Progress", "Completed", "Failed", "Cancelled"]}
    emptyText="No orders yet"
  />
);

export default PartnerMyOrders;
