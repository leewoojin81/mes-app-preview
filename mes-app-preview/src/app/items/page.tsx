import ItemMasterView from "@/components/ItemMasterView";

export default function ItemMasterPage() {
  return (
    <ItemMasterView
      title="제품정보"
      code="BASE-01"
      categories={["완제품", "반제품"]}
      showRepFilter
      fullItemForm
      defaultPageSize={200}
    />
  );
}
