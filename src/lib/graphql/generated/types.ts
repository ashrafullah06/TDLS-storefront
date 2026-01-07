import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** A date string, such as 2007-12-03, compliant with the `full-date` format outlined in section 5.6 of the RFC 3339 profile of the ISO 8601 standard for representation of dates and times using the Gregorian calendar. */
  Date: { input: any; output: any; }
  /** A date-time string at UTC, such as 2007-12-03T10:15:30Z, compliant with the `date-time` format outlined in section 5.6 of the RFC 3339 profile of the ISO 8601 standard for representation of dates and times using the Gregorian calendar. */
  DateTime: { input: string; output: string; }
  /** The `JSON` scalar type represents JSON values as specified by [ECMA-404](http://www.ecma-international.org/publications/files/ECMA-ST/ECMA-404.pdf). */
  JSON: { input: any; output: any; }
  /** The `BigInt` scalar type represents non-fractional signed whole numeric values. */
  Long: { input: any; output: any; }
  /** The `Upload` scalar type represents a file upload. */
  Upload: { input: any; output: any; }
};

export type About = {
  __typename: 'About';
  content?: Maybe<Scalars['JSON']['output']>;
  cover_image?: Maybe<UploadFileEntityResponse>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  seo_description?: Maybe<Scalars['String']['output']>;
  slug?: Maybe<Scalars['String']['output']>;
  title?: Maybe<Scalars['String']['output']>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};

export type AboutEntity = {
  __typename: 'AboutEntity';
  attributes?: Maybe<About>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type AboutEntityResponse = {
  __typename: 'AboutEntityResponse';
  data?: Maybe<AboutEntity>;
};

export type AboutEntityResponseCollection = {
  __typename: 'AboutEntityResponseCollection';
  data: Array<AboutEntity>;
  meta: ResponseCollectionMeta;
};

export type AboutFiltersInput = {
  and?: InputMaybe<Array<InputMaybe<AboutFiltersInput>>>;
  content?: InputMaybe<JsonFilterInput>;
  createdAt?: InputMaybe<DateTimeFilterInput>;
  id?: InputMaybe<IdFilterInput>;
  not?: InputMaybe<AboutFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<AboutFiltersInput>>>;
  publishedAt?: InputMaybe<DateTimeFilterInput>;
  seo_description?: InputMaybe<StringFilterInput>;
  slug?: InputMaybe<StringFilterInput>;
  title?: InputMaybe<StringFilterInput>;
  updatedAt?: InputMaybe<DateTimeFilterInput>;
};

export type AboutInput = {
  content?: InputMaybe<Scalars['JSON']['input']>;
  cover_image?: InputMaybe<Scalars['ID']['input']>;
  publishedAt?: InputMaybe<Scalars['DateTime']['input']>;
  seo_description?: InputMaybe<Scalars['String']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type AgeGroup = {
  __typename: 'AgeGroup';
  audience_categories?: Maybe<AudienceCategoryRelationResponseCollection>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  gender_groups?: Maybe<GenderGroupRelationResponseCollection>;
  name?: Maybe<Scalars['String']['output']>;
  priority?: Maybe<Scalars['Int']['output']>;
  products?: Maybe<ProductRelationResponseCollection>;
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  slug?: Maybe<Scalars['String']['output']>;
  unit?: Maybe<Enum_Agegroup_Unit>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};


export type AgeGroupAudience_CategoriesArgs = {
  filters?: InputMaybe<AudienceCategoryFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type AgeGroupGender_GroupsArgs = {
  filters?: InputMaybe<GenderGroupFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type AgeGroupProductsArgs = {
  filters?: InputMaybe<ProductFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};

export type AgeGroupEntity = {
  __typename: 'AgeGroupEntity';
  attributes?: Maybe<AgeGroup>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type AgeGroupEntityResponse = {
  __typename: 'AgeGroupEntityResponse';
  data?: Maybe<AgeGroupEntity>;
};

export type AgeGroupEntityResponseCollection = {
  __typename: 'AgeGroupEntityResponseCollection';
  data: Array<AgeGroupEntity>;
  meta: ResponseCollectionMeta;
};

export type AgeGroupFiltersInput = {
  and?: InputMaybe<Array<InputMaybe<AgeGroupFiltersInput>>>;
  audience_categories?: InputMaybe<AudienceCategoryFiltersInput>;
  createdAt?: InputMaybe<DateTimeFilterInput>;
  description?: InputMaybe<StringFilterInput>;
  gender_groups?: InputMaybe<GenderGroupFiltersInput>;
  id?: InputMaybe<IdFilterInput>;
  name?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<AgeGroupFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<AgeGroupFiltersInput>>>;
  priority?: InputMaybe<IntFilterInput>;
  products?: InputMaybe<ProductFiltersInput>;
  publishedAt?: InputMaybe<DateTimeFilterInput>;
  slug?: InputMaybe<StringFilterInput>;
  unit?: InputMaybe<StringFilterInput>;
  updatedAt?: InputMaybe<DateTimeFilterInput>;
};

export type AgeGroupInput = {
  audience_categories?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  description?: InputMaybe<Scalars['String']['input']>;
  gender_groups?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  name?: InputMaybe<Scalars['String']['input']>;
  priority?: InputMaybe<Scalars['Int']['input']>;
  products?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  publishedAt?: InputMaybe<Scalars['DateTime']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
  unit?: InputMaybe<Enum_Agegroup_Unit>;
};

export type AgeGroupRelationResponseCollection = {
  __typename: 'AgeGroupRelationResponseCollection';
  data: Array<AgeGroupEntity>;
};

export type ArchiveRecord = {
  __typename: 'ArchiveRecord';
  affected_order?: Maybe<OrderEntityResponse>;
  affected_product?: Maybe<ProductEntityResponse>;
  archive_note?: Maybe<Scalars['JSON']['output']>;
  archive_reason?: Maybe<Scalars['String']['output']>;
  archive_uid?: Maybe<Scalars['String']['output']>;
  archived_at?: Maybe<Scalars['DateTime']['output']>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  is_archived?: Maybe<Scalars['Boolean']['output']>;
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  restore_possible?: Maybe<Scalars['Boolean']['output']>;
  restored_at?: Maybe<Scalars['DateTime']['output']>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};

export type ArchiveRecordEntity = {
  __typename: 'ArchiveRecordEntity';
  attributes?: Maybe<ArchiveRecord>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type ArchiveRecordEntityResponse = {
  __typename: 'ArchiveRecordEntityResponse';
  data?: Maybe<ArchiveRecordEntity>;
};

export type ArchiveRecordEntityResponseCollection = {
  __typename: 'ArchiveRecordEntityResponseCollection';
  data: Array<ArchiveRecordEntity>;
  meta: ResponseCollectionMeta;
};

export type ArchiveRecordFiltersInput = {
  affected_order?: InputMaybe<OrderFiltersInput>;
  affected_product?: InputMaybe<ProductFiltersInput>;
  and?: InputMaybe<Array<InputMaybe<ArchiveRecordFiltersInput>>>;
  archive_note?: InputMaybe<JsonFilterInput>;
  archive_reason?: InputMaybe<StringFilterInput>;
  archive_uid?: InputMaybe<StringFilterInput>;
  archived_at?: InputMaybe<DateTimeFilterInput>;
  createdAt?: InputMaybe<DateTimeFilterInput>;
  id?: InputMaybe<IdFilterInput>;
  is_archived?: InputMaybe<BooleanFilterInput>;
  not?: InputMaybe<ArchiveRecordFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<ArchiveRecordFiltersInput>>>;
  publishedAt?: InputMaybe<DateTimeFilterInput>;
  restore_possible?: InputMaybe<BooleanFilterInput>;
  restored_at?: InputMaybe<DateTimeFilterInput>;
  updatedAt?: InputMaybe<DateTimeFilterInput>;
};

export type ArchiveRecordInput = {
  affected_order?: InputMaybe<Scalars['ID']['input']>;
  affected_product?: InputMaybe<Scalars['ID']['input']>;
  archive_note?: InputMaybe<Scalars['JSON']['input']>;
  archive_reason?: InputMaybe<Scalars['String']['input']>;
  archive_uid?: InputMaybe<Scalars['String']['input']>;
  archived_at?: InputMaybe<Scalars['DateTime']['input']>;
  is_archived?: InputMaybe<Scalars['Boolean']['input']>;
  publishedAt?: InputMaybe<Scalars['DateTime']['input']>;
  restore_possible?: InputMaybe<Scalars['Boolean']['input']>;
  restored_at?: InputMaybe<Scalars['DateTime']['input']>;
};

export type AudienceCategory = {
  __typename: 'AudienceCategory';
  age_groups?: Maybe<AgeGroupRelationResponseCollection>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  events_products_collections?: Maybe<EventsProductsCollectionRelationResponseCollection>;
  name: Scalars['String']['output'];
  priority?: Maybe<Scalars['Int']['output']>;
  products?: Maybe<ProductRelationResponseCollection>;
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  slug?: Maybe<Scalars['String']['output']>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};


export type AudienceCategoryAge_GroupsArgs = {
  filters?: InputMaybe<AgeGroupFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type AudienceCategoryEvents_Products_CollectionsArgs = {
  filters?: InputMaybe<EventsProductsCollectionFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type AudienceCategoryProductsArgs = {
  filters?: InputMaybe<ProductFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};

export type AudienceCategoryEntity = {
  __typename: 'AudienceCategoryEntity';
  attributes?: Maybe<AudienceCategory>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type AudienceCategoryEntityResponse = {
  __typename: 'AudienceCategoryEntityResponse';
  data?: Maybe<AudienceCategoryEntity>;
};

export type AudienceCategoryEntityResponseCollection = {
  __typename: 'AudienceCategoryEntityResponseCollection';
  data: Array<AudienceCategoryEntity>;
  meta: ResponseCollectionMeta;
};

export type AudienceCategoryFiltersInput = {
  age_groups?: InputMaybe<AgeGroupFiltersInput>;
  and?: InputMaybe<Array<InputMaybe<AudienceCategoryFiltersInput>>>;
  createdAt?: InputMaybe<DateTimeFilterInput>;
  description?: InputMaybe<StringFilterInput>;
  events_products_collections?: InputMaybe<EventsProductsCollectionFiltersInput>;
  id?: InputMaybe<IdFilterInput>;
  name?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<AudienceCategoryFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<AudienceCategoryFiltersInput>>>;
  priority?: InputMaybe<IntFilterInput>;
  products?: InputMaybe<ProductFiltersInput>;
  publishedAt?: InputMaybe<DateTimeFilterInput>;
  slug?: InputMaybe<StringFilterInput>;
  updatedAt?: InputMaybe<DateTimeFilterInput>;
};

export type AudienceCategoryInput = {
  age_groups?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  description?: InputMaybe<Scalars['String']['input']>;
  events_products_collections?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  name?: InputMaybe<Scalars['String']['input']>;
  priority?: InputMaybe<Scalars['Int']['input']>;
  products?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  publishedAt?: InputMaybe<Scalars['DateTime']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
};

export type AudienceCategoryRelationResponseCollection = {
  __typename: 'AudienceCategoryRelationResponseCollection';
  data: Array<AudienceCategoryEntity>;
};

export type BooleanFilterInput = {
  and?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>;
  between?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>;
  contains?: InputMaybe<Scalars['Boolean']['input']>;
  containsi?: InputMaybe<Scalars['Boolean']['input']>;
  endsWith?: InputMaybe<Scalars['Boolean']['input']>;
  eq?: InputMaybe<Scalars['Boolean']['input']>;
  eqi?: InputMaybe<Scalars['Boolean']['input']>;
  gt?: InputMaybe<Scalars['Boolean']['input']>;
  gte?: InputMaybe<Scalars['Boolean']['input']>;
  in?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>;
  lt?: InputMaybe<Scalars['Boolean']['input']>;
  lte?: InputMaybe<Scalars['Boolean']['input']>;
  ne?: InputMaybe<Scalars['Boolean']['input']>;
  nei?: InputMaybe<Scalars['Boolean']['input']>;
  not?: InputMaybe<BooleanFilterInput>;
  notContains?: InputMaybe<Scalars['Boolean']['input']>;
  notContainsi?: InputMaybe<Scalars['Boolean']['input']>;
  notIn?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>;
  notNull?: InputMaybe<Scalars['Boolean']['input']>;
  null?: InputMaybe<Scalars['Boolean']['input']>;
  or?: InputMaybe<Array<InputMaybe<Scalars['Boolean']['input']>>>;
  startsWith?: InputMaybe<Scalars['Boolean']['input']>;
};

export type BrandTier = {
  __typename: 'BrandTier';
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  description?: Maybe<Scalars['JSON']['output']>;
  is_active?: Maybe<Scalars['Boolean']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  priority?: Maybe<Scalars['Int']['output']>;
  products?: Maybe<ProductRelationResponseCollection>;
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  slug?: Maybe<Scalars['String']['output']>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};


export type BrandTierProductsArgs = {
  filters?: InputMaybe<ProductFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};

export type BrandTierEntity = {
  __typename: 'BrandTierEntity';
  attributes?: Maybe<BrandTier>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type BrandTierEntityResponse = {
  __typename: 'BrandTierEntityResponse';
  data?: Maybe<BrandTierEntity>;
};

export type BrandTierEntityResponseCollection = {
  __typename: 'BrandTierEntityResponseCollection';
  data: Array<BrandTierEntity>;
  meta: ResponseCollectionMeta;
};

export type BrandTierFiltersInput = {
  and?: InputMaybe<Array<InputMaybe<BrandTierFiltersInput>>>;
  createdAt?: InputMaybe<DateTimeFilterInput>;
  description?: InputMaybe<JsonFilterInput>;
  id?: InputMaybe<IdFilterInput>;
  is_active?: InputMaybe<BooleanFilterInput>;
  name?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<BrandTierFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<BrandTierFiltersInput>>>;
  priority?: InputMaybe<IntFilterInput>;
  products?: InputMaybe<ProductFiltersInput>;
  publishedAt?: InputMaybe<DateTimeFilterInput>;
  slug?: InputMaybe<StringFilterInput>;
  updatedAt?: InputMaybe<DateTimeFilterInput>;
};

export type BrandTierInput = {
  description?: InputMaybe<Scalars['JSON']['input']>;
  is_active?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  priority?: InputMaybe<Scalars['Int']['input']>;
  products?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  publishedAt?: InputMaybe<Scalars['DateTime']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
};

export type BrandTierRelationResponseCollection = {
  __typename: 'BrandTierRelationResponseCollection';
  data: Array<BrandTierEntity>;
};

export type Category = {
  __typename: 'Category';
  category_code?: Maybe<Scalars['String']['output']>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  is_active?: Maybe<Scalars['Boolean']['output']>;
  is_featured?: Maybe<Scalars['Boolean']['output']>;
  name: Scalars['String']['output'];
  priority?: Maybe<Scalars['Int']['output']>;
  products?: Maybe<ProductRelationResponseCollection>;
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  short_description?: Maybe<Scalars['JSON']['output']>;
  slug?: Maybe<Scalars['String']['output']>;
  tags?: Maybe<TagRelationResponseCollection>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};


export type CategoryProductsArgs = {
  filters?: InputMaybe<ProductFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type CategoryTagsArgs = {
  filters?: InputMaybe<TagFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};

export type CategoryEntity = {
  __typename: 'CategoryEntity';
  attributes?: Maybe<Category>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type CategoryEntityResponse = {
  __typename: 'CategoryEntityResponse';
  data?: Maybe<CategoryEntity>;
};

export type CategoryEntityResponseCollection = {
  __typename: 'CategoryEntityResponseCollection';
  data: Array<CategoryEntity>;
  meta: ResponseCollectionMeta;
};

export type CategoryFiltersInput = {
  and?: InputMaybe<Array<InputMaybe<CategoryFiltersInput>>>;
  category_code?: InputMaybe<StringFilterInput>;
  createdAt?: InputMaybe<DateTimeFilterInput>;
  id?: InputMaybe<IdFilterInput>;
  is_active?: InputMaybe<BooleanFilterInput>;
  is_featured?: InputMaybe<BooleanFilterInput>;
  name?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<CategoryFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<CategoryFiltersInput>>>;
  priority?: InputMaybe<IntFilterInput>;
  products?: InputMaybe<ProductFiltersInput>;
  publishedAt?: InputMaybe<DateTimeFilterInput>;
  short_description?: InputMaybe<JsonFilterInput>;
  slug?: InputMaybe<StringFilterInput>;
  tags?: InputMaybe<TagFiltersInput>;
  updatedAt?: InputMaybe<DateTimeFilterInput>;
};

export type CategoryInput = {
  category_code?: InputMaybe<Scalars['String']['input']>;
  is_active?: InputMaybe<Scalars['Boolean']['input']>;
  is_featured?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  priority?: InputMaybe<Scalars['Int']['input']>;
  products?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  publishedAt?: InputMaybe<Scalars['DateTime']['input']>;
  short_description?: InputMaybe<Scalars['JSON']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
  tags?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
};

export type CategoryRelationResponseCollection = {
  __typename: 'CategoryRelationResponseCollection';
  data: Array<CategoryEntity>;
};

export type ComponentContactSocialLinks = {
  __typename: 'ComponentContactSocialLinks';
  id: Scalars['ID']['output'];
  links?: Maybe<Scalars['String']['output']>;
  platform?: Maybe<Enum_Componentcontactsociallinks_Platform>;
};

export type ComponentContactSocialLinksFiltersInput = {
  and?: InputMaybe<Array<InputMaybe<ComponentContactSocialLinksFiltersInput>>>;
  links?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<ComponentContactSocialLinksFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<ComponentContactSocialLinksFiltersInput>>>;
  platform?: InputMaybe<StringFilterInput>;
};

export type ComponentContactSocialLinksInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  links?: InputMaybe<Scalars['String']['input']>;
  platform?: InputMaybe<Enum_Componentcontactsociallinks_Platform>;
};

export type ComponentOrderComponentsAddressSnapshot = {
  __typename: 'ComponentOrderComponentsAddressSnapshot';
  Police_station_town_upazila: Scalars['String']['output'];
  address_line1: Scalars['String']['output'];
  address_line2_Union: Scalars['String']['output'];
  country: Scalars['String']['output'];
  district: Scalars['String']['output'];
  division: Scalars['String']['output'];
  full_name: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  note?: Maybe<Scalars['JSON']['output']>;
  phone_number: Scalars['String']['output'];
  postal_code?: Maybe<Scalars['String']['output']>;
};

export type ComponentOrderComponentsAddressSnapshotFiltersInput = {
  Police_station_town_upazila?: InputMaybe<StringFilterInput>;
  address_line1?: InputMaybe<StringFilterInput>;
  address_line2_Union?: InputMaybe<StringFilterInput>;
  and?: InputMaybe<Array<InputMaybe<ComponentOrderComponentsAddressSnapshotFiltersInput>>>;
  country?: InputMaybe<StringFilterInput>;
  district?: InputMaybe<StringFilterInput>;
  division?: InputMaybe<StringFilterInput>;
  full_name?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<ComponentOrderComponentsAddressSnapshotFiltersInput>;
  note?: InputMaybe<JsonFilterInput>;
  or?: InputMaybe<Array<InputMaybe<ComponentOrderComponentsAddressSnapshotFiltersInput>>>;
  phone_number?: InputMaybe<StringFilterInput>;
  postal_code?: InputMaybe<StringFilterInput>;
};

export type ComponentOrderComponentsAddressSnapshotInput = {
  Police_station_town_upazila?: InputMaybe<Scalars['String']['input']>;
  address_line1?: InputMaybe<Scalars['String']['input']>;
  address_line2_Union?: InputMaybe<Scalars['String']['input']>;
  country?: InputMaybe<Scalars['String']['input']>;
  district?: InputMaybe<Scalars['String']['input']>;
  division?: InputMaybe<Scalars['String']['input']>;
  full_name?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  note?: InputMaybe<Scalars['JSON']['input']>;
  phone_number?: InputMaybe<Scalars['String']['input']>;
  postal_code?: InputMaybe<Scalars['String']['input']>;
};

export type ComponentOrderComponentsProductItems = {
  __typename: 'ComponentOrderComponentsProductItems';
  id: Scalars['ID']['output'];
  product_name_snapshot?: Maybe<Scalars['String']['output']>;
  product_price_snapshot?: Maybe<Scalars['Float']['output']>;
  product_ref?: Maybe<ProductEntityResponse>;
  quantity?: Maybe<Scalars['Int']['output']>;
  selected_color?: Maybe<Scalars['String']['output']>;
  selected_size?: Maybe<Scalars['String']['output']>;
  subtotal_price?: Maybe<Scalars['Float']['output']>;
};

export type ComponentOrderComponentsProductItemsFiltersInput = {
  and?: InputMaybe<Array<InputMaybe<ComponentOrderComponentsProductItemsFiltersInput>>>;
  not?: InputMaybe<ComponentOrderComponentsProductItemsFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<ComponentOrderComponentsProductItemsFiltersInput>>>;
  product_name_snapshot?: InputMaybe<StringFilterInput>;
  product_price_snapshot?: InputMaybe<FloatFilterInput>;
  product_ref?: InputMaybe<ProductFiltersInput>;
  quantity?: InputMaybe<IntFilterInput>;
  selected_color?: InputMaybe<StringFilterInput>;
  selected_size?: InputMaybe<StringFilterInput>;
  subtotal_price?: InputMaybe<FloatFilterInput>;
};

export type ComponentOrderComponentsProductItemsInput = {
  id?: InputMaybe<Scalars['ID']['input']>;
  product_name_snapshot?: InputMaybe<Scalars['String']['input']>;
  product_price_snapshot?: InputMaybe<Scalars['Float']['input']>;
  product_ref?: InputMaybe<Scalars['ID']['input']>;
  quantity?: InputMaybe<Scalars['Int']['input']>;
  selected_color?: InputMaybe<Scalars['String']['input']>;
  selected_size?: InputMaybe<Scalars['String']['input']>;
  subtotal_price?: InputMaybe<Scalars['Float']['input']>;
};

export type ComponentProductDetailsProductIdentity = {
  __typename: 'ComponentProductDetailsProductIdentity';
  arch_ref?: Maybe<ArchiveRecordEntityResponse>;
  creator?: Maybe<UsersPermissionsUserEntityResponse>;
  factory_batch_code?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  internal_notes?: Maybe<Scalars['JSON']['output']>;
  label_serial_code?: Maybe<Scalars['String']['output']>;
  tag_serial_code?: Maybe<Scalars['String']['output']>;
  verification_status?: Maybe<Enum_Componentproductdetailsproductidentity_Verification_Status>;
  verified_at?: Maybe<Scalars['DateTime']['output']>;
  verifier?: Maybe<UsersPermissionsUserEntityResponse>;
};

export type ComponentProductDetailsProductIdentityFiltersInput = {
  and?: InputMaybe<Array<InputMaybe<ComponentProductDetailsProductIdentityFiltersInput>>>;
  arch_ref?: InputMaybe<ArchiveRecordFiltersInput>;
  creator?: InputMaybe<UsersPermissionsUserFiltersInput>;
  factory_batch_code?: InputMaybe<StringFilterInput>;
  internal_notes?: InputMaybe<JsonFilterInput>;
  label_serial_code?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<ComponentProductDetailsProductIdentityFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<ComponentProductDetailsProductIdentityFiltersInput>>>;
  tag_serial_code?: InputMaybe<StringFilterInput>;
  verification_status?: InputMaybe<StringFilterInput>;
  verified_at?: InputMaybe<DateTimeFilterInput>;
  verifier?: InputMaybe<UsersPermissionsUserFiltersInput>;
};

export type ComponentProductDetailsProductIdentityInput = {
  arch_ref?: InputMaybe<Scalars['ID']['input']>;
  creator?: InputMaybe<Scalars['ID']['input']>;
  factory_batch_code?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  internal_notes?: InputMaybe<Scalars['JSON']['input']>;
  label_serial_code?: InputMaybe<Scalars['String']['input']>;
  tag_serial_code?: InputMaybe<Scalars['String']['input']>;
  verification_status?: InputMaybe<Enum_Componentproductdetailsproductidentity_Verification_Status>;
  verified_at?: InputMaybe<Scalars['DateTime']['input']>;
  verifier?: InputMaybe<Scalars['ID']['input']>;
};

export type ComponentSectionsHeroSlides1 = {
  __typename: 'ComponentSectionsHeroSlides1';
  background_image?: Maybe<UploadFileEntityResponse>;
  cta_link?: Maybe<Scalars['String']['output']>;
  cta_text?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  mobile_image?: Maybe<UploadFileEntityResponse>;
  overlay_color?: Maybe<Scalars['String']['output']>;
  overlay_opacity?: Maybe<Scalars['Float']['output']>;
  subtitle?: Maybe<Scalars['String']['output']>;
  title?: Maybe<Scalars['String']['output']>;
  video?: Maybe<UploadFileEntityResponse>;
};

export type ComponentSectionsHeroSlides1FiltersInput = {
  and?: InputMaybe<Array<InputMaybe<ComponentSectionsHeroSlides1FiltersInput>>>;
  cta_link?: InputMaybe<StringFilterInput>;
  cta_text?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<ComponentSectionsHeroSlides1FiltersInput>;
  or?: InputMaybe<Array<InputMaybe<ComponentSectionsHeroSlides1FiltersInput>>>;
  overlay_color?: InputMaybe<StringFilterInput>;
  overlay_opacity?: InputMaybe<FloatFilterInput>;
  subtitle?: InputMaybe<StringFilterInput>;
  title?: InputMaybe<StringFilterInput>;
};

export type ComponentSectionsHeroSlides1Input = {
  background_image?: InputMaybe<Scalars['ID']['input']>;
  cta_link?: InputMaybe<Scalars['String']['input']>;
  cta_text?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  mobile_image?: InputMaybe<Scalars['ID']['input']>;
  overlay_color?: InputMaybe<Scalars['String']['input']>;
  overlay_opacity?: InputMaybe<Scalars['Float']['input']>;
  subtitle?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
  video?: InputMaybe<Scalars['ID']['input']>;
};

export type ComponentSectionsPromoBar = {
  __typename: 'ComponentSectionsPromoBar';
  active?: Maybe<Scalars['Boolean']['output']>;
  animation?: Maybe<Enum_Componentsectionspromobar_Animation>;
  background_color?: Maybe<Scalars['String']['output']>;
  cta_link?: Maybe<Scalars['String']['output']>;
  cta_text?: Maybe<Scalars['String']['output']>;
  custom_page_slug?: Maybe<Scalars['String']['output']>;
  device_visibility?: Maybe<Enum_Componentsectionspromobar_Device_Visibility>;
  display_on_pages?: Maybe<Enum_Componentsectionspromobar_Display_On_Pages>;
  end_datetime?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['ID']['output'];
  message?: Maybe<Scalars['String']['output']>;
  priority?: Maybe<Scalars['Int']['output']>;
  show_close_button?: Maybe<Scalars['Boolean']['output']>;
  start_datetime?: Maybe<Scalars['DateTime']['output']>;
  text_color?: Maybe<Scalars['String']['output']>;
};

export type ComponentSectionsPromoBarFiltersInput = {
  active?: InputMaybe<BooleanFilterInput>;
  and?: InputMaybe<Array<InputMaybe<ComponentSectionsPromoBarFiltersInput>>>;
  animation?: InputMaybe<StringFilterInput>;
  background_color?: InputMaybe<StringFilterInput>;
  cta_link?: InputMaybe<StringFilterInput>;
  cta_text?: InputMaybe<StringFilterInput>;
  custom_page_slug?: InputMaybe<StringFilterInput>;
  device_visibility?: InputMaybe<StringFilterInput>;
  display_on_pages?: InputMaybe<StringFilterInput>;
  end_datetime?: InputMaybe<DateTimeFilterInput>;
  message?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<ComponentSectionsPromoBarFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<ComponentSectionsPromoBarFiltersInput>>>;
  priority?: InputMaybe<IntFilterInput>;
  show_close_button?: InputMaybe<BooleanFilterInput>;
  start_datetime?: InputMaybe<DateTimeFilterInput>;
  text_color?: InputMaybe<StringFilterInput>;
};

export type ComponentSectionsPromoBarInput = {
  active?: InputMaybe<Scalars['Boolean']['input']>;
  animation?: InputMaybe<Enum_Componentsectionspromobar_Animation>;
  background_color?: InputMaybe<Scalars['String']['input']>;
  cta_link?: InputMaybe<Scalars['String']['input']>;
  cta_text?: InputMaybe<Scalars['String']['input']>;
  custom_page_slug?: InputMaybe<Scalars['String']['input']>;
  device_visibility?: InputMaybe<Enum_Componentsectionspromobar_Device_Visibility>;
  display_on_pages?: InputMaybe<Enum_Componentsectionspromobar_Display_On_Pages>;
  end_datetime?: InputMaybe<Scalars['DateTime']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  message?: InputMaybe<Scalars['String']['input']>;
  priority?: InputMaybe<Scalars['Int']['input']>;
  show_close_button?: InputMaybe<Scalars['Boolean']['input']>;
  start_datetime?: InputMaybe<Scalars['DateTime']['input']>;
  text_color?: InputMaybe<Scalars['String']['input']>;
};

export type ComponentVariantProductVariant = {
  __typename: 'ComponentVariantProductVariant';
  color_code?: Maybe<Scalars['String']['output']>;
  color_name?: Maybe<Enum_Componentvariantproductvariant_Color_Name>;
  id: Scalars['ID']['output'];
  images?: Maybe<UploadFileRelationResponseCollection>;
  sizes?: Maybe<Array<Maybe<ComponentVariantSizeStock>>>;
};


export type ComponentVariantProductVariantImagesArgs = {
  filters?: InputMaybe<UploadFileFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type ComponentVariantProductVariantSizesArgs = {
  filters?: InputMaybe<ComponentVariantSizeStockFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};

export type ComponentVariantProductVariantFiltersInput = {
  and?: InputMaybe<Array<InputMaybe<ComponentVariantProductVariantFiltersInput>>>;
  color_code?: InputMaybe<StringFilterInput>;
  color_name?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<ComponentVariantProductVariantFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<ComponentVariantProductVariantFiltersInput>>>;
  sizes?: InputMaybe<ComponentVariantSizeStockFiltersInput>;
};

export type ComponentVariantProductVariantInput = {
  color_code?: InputMaybe<Scalars['String']['input']>;
  color_name?: InputMaybe<Enum_Componentvariantproductvariant_Color_Name>;
  id?: InputMaybe<Scalars['ID']['input']>;
  images?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  sizes?: InputMaybe<Array<InputMaybe<ComponentVariantSizeStockInput>>>;
};

export type ComponentVariantSizeStock = {
  __typename: 'ComponentVariantSizeStock';
  backorder_allowed?: Maybe<Scalars['Boolean']['output']>;
  barcode?: Maybe<Scalars['String']['output']>;
  compare_at_price?: Maybe<Scalars['Int']['output']>;
  generated_sku?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  inventory_count?: Maybe<Scalars['Int']['output']>;
  inventory_status?: Maybe<Enum_Componentvariantsizestock_Inventory_Status>;
  is_active?: Maybe<Scalars['Boolean']['output']>;
  price?: Maybe<Scalars['Int']['output']>;
  price_override?: Maybe<Scalars['Int']['output']>;
  reorder_level?: Maybe<Scalars['Int']['output']>;
  restock_date?: Maybe<Scalars['DateTime']['output']>;
  size_name?: Maybe<Enum_Componentvariantsizestock_Size_Name>;
  sold_count?: Maybe<Scalars['Int']['output']>;
  stock_quantity?: Maybe<Scalars['Int']['output']>;
  warehouse_location?: Maybe<Enum_Componentvariantsizestock_Warehouse_Location>;
};

export type ComponentVariantSizeStockFiltersInput = {
  and?: InputMaybe<Array<InputMaybe<ComponentVariantSizeStockFiltersInput>>>;
  backorder_allowed?: InputMaybe<BooleanFilterInput>;
  barcode?: InputMaybe<StringFilterInput>;
  compare_at_price?: InputMaybe<IntFilterInput>;
  generated_sku?: InputMaybe<StringFilterInput>;
  inventory_count?: InputMaybe<IntFilterInput>;
  inventory_status?: InputMaybe<StringFilterInput>;
  is_active?: InputMaybe<BooleanFilterInput>;
  not?: InputMaybe<ComponentVariantSizeStockFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<ComponentVariantSizeStockFiltersInput>>>;
  price?: InputMaybe<IntFilterInput>;
  price_override?: InputMaybe<IntFilterInput>;
  reorder_level?: InputMaybe<IntFilterInput>;
  restock_date?: InputMaybe<DateTimeFilterInput>;
  size_name?: InputMaybe<StringFilterInput>;
  sold_count?: InputMaybe<IntFilterInput>;
  stock_quantity?: InputMaybe<IntFilterInput>;
  warehouse_location?: InputMaybe<StringFilterInput>;
};

export type ComponentVariantSizeStockInput = {
  backorder_allowed?: InputMaybe<Scalars['Boolean']['input']>;
  barcode?: InputMaybe<Scalars['String']['input']>;
  compare_at_price?: InputMaybe<Scalars['Int']['input']>;
  generated_sku?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  inventory_count?: InputMaybe<Scalars['Int']['input']>;
  inventory_status?: InputMaybe<Enum_Componentvariantsizestock_Inventory_Status>;
  is_active?: InputMaybe<Scalars['Boolean']['input']>;
  price?: InputMaybe<Scalars['Int']['input']>;
  price_override?: InputMaybe<Scalars['Int']['input']>;
  reorder_level?: InputMaybe<Scalars['Int']['input']>;
  restock_date?: InputMaybe<Scalars['DateTime']['input']>;
  size_name?: InputMaybe<Enum_Componentvariantsizestock_Size_Name>;
  sold_count?: InputMaybe<Scalars['Int']['input']>;
  stock_quantity?: InputMaybe<Scalars['Int']['input']>;
  warehouse_location?: InputMaybe<Enum_Componentvariantsizestock_Warehouse_Location>;
};

export type Contact = {
  __typename: 'Contact';
  address?: Maybe<Scalars['JSON']['output']>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  email?: Maybe<Scalars['String']['output']>;
  map_embed_code?: Maybe<Scalars['String']['output']>;
  phone?: Maybe<Scalars['String']['output']>;
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  slug?: Maybe<Scalars['String']['output']>;
  social_links?: Maybe<ComponentContactSocialLinks>;
  title?: Maybe<Scalars['String']['output']>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};

export type ContactEntity = {
  __typename: 'ContactEntity';
  attributes?: Maybe<Contact>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type ContactEntityResponse = {
  __typename: 'ContactEntityResponse';
  data?: Maybe<ContactEntity>;
};

export type ContactEntityResponseCollection = {
  __typename: 'ContactEntityResponseCollection';
  data: Array<ContactEntity>;
  meta: ResponseCollectionMeta;
};

export type ContactFiltersInput = {
  address?: InputMaybe<JsonFilterInput>;
  and?: InputMaybe<Array<InputMaybe<ContactFiltersInput>>>;
  createdAt?: InputMaybe<DateTimeFilterInput>;
  email?: InputMaybe<StringFilterInput>;
  id?: InputMaybe<IdFilterInput>;
  map_embed_code?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<ContactFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<ContactFiltersInput>>>;
  phone?: InputMaybe<StringFilterInput>;
  publishedAt?: InputMaybe<DateTimeFilterInput>;
  slug?: InputMaybe<StringFilterInput>;
  social_links?: InputMaybe<ComponentContactSocialLinksFiltersInput>;
  title?: InputMaybe<StringFilterInput>;
  updatedAt?: InputMaybe<DateTimeFilterInput>;
};

export type ContactInput = {
  address?: InputMaybe<Scalars['JSON']['input']>;
  email?: InputMaybe<Scalars['String']['input']>;
  map_embed_code?: InputMaybe<Scalars['String']['input']>;
  phone?: InputMaybe<Scalars['String']['input']>;
  publishedAt?: InputMaybe<Scalars['DateTime']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
  social_links?: InputMaybe<ComponentContactSocialLinksInput>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type DateFilterInput = {
  and?: InputMaybe<Array<InputMaybe<Scalars['Date']['input']>>>;
  between?: InputMaybe<Array<InputMaybe<Scalars['Date']['input']>>>;
  contains?: InputMaybe<Scalars['Date']['input']>;
  containsi?: InputMaybe<Scalars['Date']['input']>;
  endsWith?: InputMaybe<Scalars['Date']['input']>;
  eq?: InputMaybe<Scalars['Date']['input']>;
  eqi?: InputMaybe<Scalars['Date']['input']>;
  gt?: InputMaybe<Scalars['Date']['input']>;
  gte?: InputMaybe<Scalars['Date']['input']>;
  in?: InputMaybe<Array<InputMaybe<Scalars['Date']['input']>>>;
  lt?: InputMaybe<Scalars['Date']['input']>;
  lte?: InputMaybe<Scalars['Date']['input']>;
  ne?: InputMaybe<Scalars['Date']['input']>;
  nei?: InputMaybe<Scalars['Date']['input']>;
  not?: InputMaybe<DateFilterInput>;
  notContains?: InputMaybe<Scalars['Date']['input']>;
  notContainsi?: InputMaybe<Scalars['Date']['input']>;
  notIn?: InputMaybe<Array<InputMaybe<Scalars['Date']['input']>>>;
  notNull?: InputMaybe<Scalars['Boolean']['input']>;
  null?: InputMaybe<Scalars['Boolean']['input']>;
  or?: InputMaybe<Array<InputMaybe<Scalars['Date']['input']>>>;
  startsWith?: InputMaybe<Scalars['Date']['input']>;
};

export type DateTimeFilterInput = {
  and?: InputMaybe<Array<InputMaybe<Scalars['DateTime']['input']>>>;
  between?: InputMaybe<Array<InputMaybe<Scalars['DateTime']['input']>>>;
  contains?: InputMaybe<Scalars['DateTime']['input']>;
  containsi?: InputMaybe<Scalars['DateTime']['input']>;
  endsWith?: InputMaybe<Scalars['DateTime']['input']>;
  eq?: InputMaybe<Scalars['DateTime']['input']>;
  eqi?: InputMaybe<Scalars['DateTime']['input']>;
  gt?: InputMaybe<Scalars['DateTime']['input']>;
  gte?: InputMaybe<Scalars['DateTime']['input']>;
  in?: InputMaybe<Array<InputMaybe<Scalars['DateTime']['input']>>>;
  lt?: InputMaybe<Scalars['DateTime']['input']>;
  lte?: InputMaybe<Scalars['DateTime']['input']>;
  ne?: InputMaybe<Scalars['DateTime']['input']>;
  nei?: InputMaybe<Scalars['DateTime']['input']>;
  not?: InputMaybe<DateTimeFilterInput>;
  notContains?: InputMaybe<Scalars['DateTime']['input']>;
  notContainsi?: InputMaybe<Scalars['DateTime']['input']>;
  notIn?: InputMaybe<Array<InputMaybe<Scalars['DateTime']['input']>>>;
  notNull?: InputMaybe<Scalars['Boolean']['input']>;
  null?: InputMaybe<Scalars['Boolean']['input']>;
  or?: InputMaybe<Array<InputMaybe<Scalars['DateTime']['input']>>>;
  startsWith?: InputMaybe<Scalars['DateTime']['input']>;
};

export enum Enum_Agegroup_Unit {
  Months = 'months',
  Years = 'years'
}

export enum Enum_Componentcontactsociallinks_Platform {
  Facebook = 'Facebook',
  Google = 'Google',
  Instagram = 'Instagram',
  Pinterest = 'Pinterest',
  TikTok = 'TikTok',
  Youtube = 'Youtube'
}

export enum Enum_Componentproductdetailsproductidentity_Verification_Status {
  Pending = 'pending',
  Rejected = 'rejected',
  Verified = 'verified'
}

export enum Enum_Componentsectionspromobar_Animation {
  Fade = 'fade',
  IconMedia = 'icon_media',
  Marquee = 'marquee',
  None = 'none',
  Slide = 'slide'
}

export enum Enum_Componentsectionspromobar_Device_Visibility {
  All = 'all',
  Desktop = 'desktop',
  Mobile = 'mobile'
}

export enum Enum_Componentsectionspromobar_Display_On_Pages {
  Account = 'account',
  All = 'all',
  Blog = 'blog',
  Cart = 'cart',
  Checkout = 'checkout',
  Collections = 'collections',
  Custom = 'custom',
  Homepage = 'homepage',
  Products = 'products',
  Shop = 'shop'
}

export enum Enum_Componentvariantproductvariant_Color_Name {
  Black = 'Black',
  Blue = 'Blue',
  DeepBlue = 'Deep_Blue',
  DeepNavy = 'Deep_Navy',
  Grey = 'Grey',
  Navy = 'Navy',
  Orange = 'Orange',
  Red = 'Red',
  White = 'White',
  Yellow = 'Yellow'
}

export enum Enum_Componentvariantsizestock_Inventory_Status {
  InStock = 'in_stock',
  LowStock = 'low_stock',
  RestockDue = 'restock_due'
}

export enum Enum_Componentvariantsizestock_Size_Name {
  L = 'L',
  M = 'M',
  S = 'S',
  Xl = 'XL',
  Xs = 'XS',
  Xxl = 'XXL',
  Xxs = 'XXS',
  Xxxl = 'XXXL',
  Xxxxl = 'XXXXL'
}

export enum Enum_Componentvariantsizestock_Warehouse_Location {
  Chittagong = 'Chittagong',
  Dhaka = 'Dhaka',
  Khulna = 'Khulna',
  Sylhet = 'Sylhet'
}

export enum Enum_Eventsproductscollection_Type {
  EidFestival = 'eid_festival',
  HappyNewYear = 'happy_new_year',
  PahelaBoishak = 'pahela_boishak'
}

export enum Enum_Gendergroup_Gender_Group {
  BabyBoy = 'baby_boy',
  BabyGirl = 'baby_girl',
  TeenBoy = 'teen_boy',
  TeenGirl = 'teen_girl'
}

export enum Enum_Globalsetting_Default_Currency {
  Bdt = 'BDT'
}

export enum Enum_Globalsetting_Default_Warehouse_Location {
  Dhaka = 'Dhaka'
}

export enum Enum_Order_Payment_Method {
  Amex = 'amex',
  Bkash = 'bkash',
  CashOnDelivery = 'cash_on_delivery',
  Gpay = 'gpay',
  MasterCard = 'master_card',
  Nagad = 'nagad',
  Rocket = 'rocket',
  VisaCard = 'visa_card'
}

export enum Enum_Order_Payment_Status {
  Failed = 'failed',
  Paid = 'paid',
  PaidFromCustomerDigitalTdlcWallet = 'paid_from_customer_digital_tdlc_wallet',
  Pending = 'pending',
  RefundedToCustomerDigitalTdlcWallet = 'refunded_to_customer_digital_tdlc_wallet',
  RefundedToMfsOrBankAccount = 'refunded_to_mfs_or_bank_account',
  Unpaid = 'unpaid'
}

export enum Enum_Order_Status {
  Cancelled = 'cancelled',
  Delivered = 'delivered',
  Exchanged = 'exchanged',
  Paid = 'paid',
  Pending = 'pending',
  Processing = 'processing',
  Refunded = 'refunded',
  Returned = 'returned',
  Shipped = 'shipped'
}

export enum Enum_Policy_Title {
  DigitalCurrencyPolicy = 'digital_currency_policy',
  PointRedemptionPolicy = 'point_redemption_policy',
  PrivacyPolicy = 'privacy_policy',
  RefundPolicy = 'refund_policy',
  ReturnAndExchangePolicy = 'return_and_exchange_policy',
  ShippingPolicy = 'shipping_policy'
}

export enum Enum_Product_Fit_Type {
  DropshoulderFit = 'Dropshoulder_Fit',
  OversizedFit = 'Oversized_Fit',
  Regular = 'Regular',
  RelaxedFit = 'Relaxed_Fit',
  SlimFit = 'Slim_Fit'
}

export enum Enum_Review_Archive_Reason {
  Abusive = 'abusive',
  Duplicate = 'duplicate',
  Others = 'others',
  Spam = 'spam'
}

export enum Enum_Review_Rating {
  FiveStar = 'five_star',
  FourStar = 'four_star',
  OneStar = 'one_star',
  ThreeStar = 'three_star',
  TwoStar = 'two_star'
}

export enum Enum_Review_Status {
  Approved = 'approved',
  Pending = 'pending',
  Rejected = 'rejected'
}

export enum Enum_Tag_Color_Code {
  AshGrey = 'Ash_Grey',
  Black = 'Black',
  Blue = 'Blue',
  CharcoalGrey = 'Charcoal_Grey',
  CreamWhite = 'Cream_White',
  DeepBlue = 'Deep_Blue',
  DustyPink = 'Dusty_Pink',
  ForestGreen = 'Forest_Green',
  Green = 'Green',
  IvoryWhite = 'Ivory_White',
  JetBlack = 'Jet_Black',
  Maroon = 'Maroon',
  NavyBlue = 'Navy_Blue',
  OliveGreen = 'Olive_Green',
  Red = 'Red',
  SandBeige = 'Sand_Beige',
  SkyBlue = 'Sky_Blue',
  StoneBeige = 'Stone_Beige',
  White = 'White',
  WineRed = 'Wine_Red',
  Yellow = 'Yellow'
}

export enum Enum_Tag_Tag_Type {
  AntiOdor = 'anti_odor',
  Bamboo = 'bamboo',
  BestSeller = 'best_seller',
  Bold = 'bold',
  Casual = 'casual',
  ComingSoon = 'coming_soon',
  Cotton = 'cotton',
  EidCollection = 'eid_collection',
  FairTrade = 'fair_trade',
  Festive = 'festive',
  Formal = 'formal',
  Gym = 'gym',
  HotPick = 'hot_pick',
  Kids = 'kids',
  LaunchWeek = 'launch_week',
  Linen = 'linen',
  Loungewear = 'loungewear',
  Luxury = 'luxury',
  MadeInBangladesh = 'made_in_Bangladesh',
  Men = 'men',
  Minimalist = 'minimalist',
  Modal = 'modal',
  MoistureWicking = 'moisture_wicking',
  Monsoon = 'monsoon',
  OnSale = 'on_sale',
  Organic = 'organic',
  OutOfStock = 'out_of_stock',
  OversizedFit = 'oversized_fit',
  PahelaBoishak = 'pahela_boishak',
  RelaxedFit = 'relaxed_fit',
  SlimFit = 'slim_fit',
  Stretchable = 'stretchable',
  Summer = 'summer',
  Trending = 'trending',
  Unisex = 'unisex',
  Winter = 'winter',
  Women = 'women',
  Young = 'young'
}

export enum Enum_Userspermissionsuser_Gender {
  Female = 'female',
  Male = 'male',
  NotInterestedToDisclose = 'not_interested_to_disclose'
}

export type EventsProductsCollection = {
  __typename: 'EventsProductsCollection';
  audience_categories?: Maybe<AudienceCategoryRelationResponseCollection>;
  banner_image?: Maybe<UploadFileEntityResponse>;
  cover_image?: Maybe<UploadFileRelationResponseCollection>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  description?: Maybe<Scalars['JSON']['output']>;
  end_datetime?: Maybe<Scalars['DateTime']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  priority?: Maybe<Scalars['Int']['output']>;
  products?: Maybe<ProductRelationResponseCollection>;
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  slug?: Maybe<Scalars['String']['output']>;
  start_datetime?: Maybe<Scalars['DateTime']['output']>;
  type?: Maybe<Enum_Eventsproductscollection_Type>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};


export type EventsProductsCollectionAudience_CategoriesArgs = {
  filters?: InputMaybe<AudienceCategoryFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type EventsProductsCollectionCover_ImageArgs = {
  filters?: InputMaybe<UploadFileFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type EventsProductsCollectionProductsArgs = {
  filters?: InputMaybe<ProductFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};

export type EventsProductsCollectionEntity = {
  __typename: 'EventsProductsCollectionEntity';
  attributes?: Maybe<EventsProductsCollection>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type EventsProductsCollectionEntityResponse = {
  __typename: 'EventsProductsCollectionEntityResponse';
  data?: Maybe<EventsProductsCollectionEntity>;
};

export type EventsProductsCollectionEntityResponseCollection = {
  __typename: 'EventsProductsCollectionEntityResponseCollection';
  data: Array<EventsProductsCollectionEntity>;
  meta: ResponseCollectionMeta;
};

export type EventsProductsCollectionFiltersInput = {
  and?: InputMaybe<Array<InputMaybe<EventsProductsCollectionFiltersInput>>>;
  audience_categories?: InputMaybe<AudienceCategoryFiltersInput>;
  createdAt?: InputMaybe<DateTimeFilterInput>;
  description?: InputMaybe<JsonFilterInput>;
  end_datetime?: InputMaybe<DateTimeFilterInput>;
  id?: InputMaybe<IdFilterInput>;
  name?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<EventsProductsCollectionFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<EventsProductsCollectionFiltersInput>>>;
  priority?: InputMaybe<IntFilterInput>;
  products?: InputMaybe<ProductFiltersInput>;
  publishedAt?: InputMaybe<DateTimeFilterInput>;
  slug?: InputMaybe<StringFilterInput>;
  start_datetime?: InputMaybe<DateTimeFilterInput>;
  type?: InputMaybe<StringFilterInput>;
  updatedAt?: InputMaybe<DateTimeFilterInput>;
};

export type EventsProductsCollectionInput = {
  audience_categories?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  banner_image?: InputMaybe<Scalars['ID']['input']>;
  cover_image?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  description?: InputMaybe<Scalars['JSON']['input']>;
  end_datetime?: InputMaybe<Scalars['DateTime']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  priority?: InputMaybe<Scalars['Int']['input']>;
  products?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  publishedAt?: InputMaybe<Scalars['DateTime']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
  start_datetime?: InputMaybe<Scalars['DateTime']['input']>;
  type?: InputMaybe<Enum_Eventsproductscollection_Type>;
};

export type EventsProductsCollectionRelationResponseCollection = {
  __typename: 'EventsProductsCollectionRelationResponseCollection';
  data: Array<EventsProductsCollectionEntity>;
};

export type FileInfoInput = {
  alternativeText?: InputMaybe<Scalars['String']['input']>;
  caption?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type FloatFilterInput = {
  and?: InputMaybe<Array<InputMaybe<Scalars['Float']['input']>>>;
  between?: InputMaybe<Array<InputMaybe<Scalars['Float']['input']>>>;
  contains?: InputMaybe<Scalars['Float']['input']>;
  containsi?: InputMaybe<Scalars['Float']['input']>;
  endsWith?: InputMaybe<Scalars['Float']['input']>;
  eq?: InputMaybe<Scalars['Float']['input']>;
  eqi?: InputMaybe<Scalars['Float']['input']>;
  gt?: InputMaybe<Scalars['Float']['input']>;
  gte?: InputMaybe<Scalars['Float']['input']>;
  in?: InputMaybe<Array<InputMaybe<Scalars['Float']['input']>>>;
  lt?: InputMaybe<Scalars['Float']['input']>;
  lte?: InputMaybe<Scalars['Float']['input']>;
  ne?: InputMaybe<Scalars['Float']['input']>;
  nei?: InputMaybe<Scalars['Float']['input']>;
  not?: InputMaybe<FloatFilterInput>;
  notContains?: InputMaybe<Scalars['Float']['input']>;
  notContainsi?: InputMaybe<Scalars['Float']['input']>;
  notIn?: InputMaybe<Array<InputMaybe<Scalars['Float']['input']>>>;
  notNull?: InputMaybe<Scalars['Boolean']['input']>;
  null?: InputMaybe<Scalars['Boolean']['input']>;
  or?: InputMaybe<Array<InputMaybe<Scalars['Float']['input']>>>;
  startsWith?: InputMaybe<Scalars['Float']['input']>;
};

export type GenderGroup = {
  __typename: 'GenderGroup';
  age_groups?: Maybe<AgeGroupRelationResponseCollection>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  description?: Maybe<Scalars['JSON']['output']>;
  gender_group?: Maybe<Enum_Gendergroup_Gender_Group>;
  name?: Maybe<Scalars['String']['output']>;
  priority?: Maybe<Scalars['Int']['output']>;
  products?: Maybe<ProductRelationResponseCollection>;
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  slug?: Maybe<Scalars['String']['output']>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};


export type GenderGroupAge_GroupsArgs = {
  filters?: InputMaybe<AgeGroupFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type GenderGroupProductsArgs = {
  filters?: InputMaybe<ProductFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};

export type GenderGroupEntity = {
  __typename: 'GenderGroupEntity';
  attributes?: Maybe<GenderGroup>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type GenderGroupEntityResponse = {
  __typename: 'GenderGroupEntityResponse';
  data?: Maybe<GenderGroupEntity>;
};

export type GenderGroupEntityResponseCollection = {
  __typename: 'GenderGroupEntityResponseCollection';
  data: Array<GenderGroupEntity>;
  meta: ResponseCollectionMeta;
};

export type GenderGroupFiltersInput = {
  age_groups?: InputMaybe<AgeGroupFiltersInput>;
  and?: InputMaybe<Array<InputMaybe<GenderGroupFiltersInput>>>;
  createdAt?: InputMaybe<DateTimeFilterInput>;
  description?: InputMaybe<JsonFilterInput>;
  gender_group?: InputMaybe<StringFilterInput>;
  id?: InputMaybe<IdFilterInput>;
  name?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<GenderGroupFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<GenderGroupFiltersInput>>>;
  priority?: InputMaybe<IntFilterInput>;
  products?: InputMaybe<ProductFiltersInput>;
  publishedAt?: InputMaybe<DateTimeFilterInput>;
  slug?: InputMaybe<StringFilterInput>;
  updatedAt?: InputMaybe<DateTimeFilterInput>;
};

export type GenderGroupInput = {
  age_groups?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  description?: InputMaybe<Scalars['JSON']['input']>;
  gender_group?: InputMaybe<Enum_Gendergroup_Gender_Group>;
  name?: InputMaybe<Scalars['String']['input']>;
  priority?: InputMaybe<Scalars['Int']['input']>;
  products?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  publishedAt?: InputMaybe<Scalars['DateTime']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
};

export type GenderGroupRelationResponseCollection = {
  __typename: 'GenderGroupRelationResponseCollection';
  data: Array<GenderGroupEntity>;
};

export type GenericMorph = About | AgeGroup | ArchiveRecord | AudienceCategory | BrandTier | Category | ComponentContactSocialLinks | ComponentOrderComponentsAddressSnapshot | ComponentOrderComponentsProductItems | ComponentProductDetailsProductIdentity | ComponentSectionsHeroSlides1 | ComponentSectionsPromoBar | ComponentVariantProductVariant | ComponentVariantSizeStock | Contact | EventsProductsCollection | GenderGroup | GlobalSetting | Homepage | Loyaltypointhistory | Order | Policy | Product | Referral | Review | Tag | UploadFile | UploadFolder | UsersPermissionsPermission | UsersPermissionsRole | UsersPermissionsUser;

export type GlobalSetting = {
  __typename: 'GlobalSetting';
  about_us?: Maybe<Scalars['JSON']['output']>;
  affiliate_program_info?: Maybe<Scalars['JSON']['output']>;
  api_status_page_url?: Maybe<Scalars['String']['output']>;
  autofill_enabled?: Maybe<Scalars['Boolean']['output']>;
  brand_story?: Maybe<Scalars['JSON']['output']>;
  business_registration_number?: Maybe<Scalars['String']['output']>;
  cancellation_policy?: Maybe<Scalars['JSON']['output']>;
  career_info?: Maybe<Scalars['JSON']['output']>;
  category_code_rules?: Maybe<Scalars['String']['output']>;
  contact_email?: Maybe<Scalars['String']['output']>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  customer_support_phone?: Maybe<Scalars['String']['output']>;
  data_protection_policy?: Maybe<Scalars['JSON']['output']>;
  default_backorder_allowed?: Maybe<Scalars['Boolean']['output']>;
  default_currency?: Maybe<Enum_Globalsetting_Default_Currency>;
  default_meta_description?: Maybe<Scalars['JSON']['output']>;
  default_meta_title?: Maybe<Scalars['String']['output']>;
  default_reorder_level?: Maybe<Scalars['Int']['output']>;
  default_tax_rate?: Maybe<Scalars['Float']['output']>;
  default_warehouse_location?: Maybe<Enum_Globalsetting_Default_Warehouse_Location>;
  digital_wallet_policy?: Maybe<Scalars['JSON']['output']>;
  discount_policy?: Maybe<Scalars['JSON']['output']>;
  facebook_url?: Maybe<Scalars['String']['output']>;
  faq_url?: Maybe<Scalars['String']['output']>;
  gift_card_policy?: Maybe<Scalars['JSON']['output']>;
  google_analytics_id?: Maybe<Scalars['String']['output']>;
  instagram_url?: Maybe<Scalars['String']['output']>;
  legal_disclaimer?: Maybe<Scalars['JSON']['output']>;
  live_chat_enabled?: Maybe<Scalars['Boolean']['output']>;
  loyalty_program_info?: Maybe<Scalars['JSON']['output']>;
  maintenance_mode?: Maybe<Scalars['Boolean']['output']>;
  mobile_app_download_url?: Maybe<Scalars['String']['output']>;
  newsletter_signup_url?: Maybe<Scalars['String']['output']>;
  operating_hours?: Maybe<Scalars['String']['output']>;
  order_policy?: Maybe<Scalars['JSON']['output']>;
  payment_policy?: Maybe<Scalars['JSON']['output']>;
  privacy_policy?: Maybe<Scalars['JSON']['output']>;
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  redeem_policy?: Maybe<Scalars['JSON']['output']>;
  refund_policy?: Maybe<Scalars['JSON']['output']>;
  return_and_exchange_policy?: Maybe<Scalars['JSON']['output']>;
  shipping_policy?: Maybe<Scalars['JSON']['output']>;
  site_launch_date?: Maybe<Scalars['DateTime']['output']>;
  sitemap_url?: Maybe<Scalars['String']['output']>;
  sku_format?: Maybe<Scalars['String']['output']>;
  store_location_google_map?: Maybe<Scalars['String']['output']>;
  supplier_policy?: Maybe<Scalars['JSON']['output']>;
  support_hours?: Maybe<Scalars['String']['output']>;
  terms_and_conditions?: Maybe<Scalars['JSON']['output']>;
  twitter_url?: Maybe<Scalars['String']['output']>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
  voucher_policy?: Maybe<Scalars['JSON']['output']>;
  whatsapp_support_number?: Maybe<Scalars['String']['output']>;
  youtube_url?: Maybe<Scalars['String']['output']>;
};

export type GlobalSettingEntity = {
  __typename: 'GlobalSettingEntity';
  attributes?: Maybe<GlobalSetting>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type GlobalSettingEntityResponse = {
  __typename: 'GlobalSettingEntityResponse';
  data?: Maybe<GlobalSettingEntity>;
};

export type GlobalSettingInput = {
  about_us?: InputMaybe<Scalars['JSON']['input']>;
  affiliate_program_info?: InputMaybe<Scalars['JSON']['input']>;
  api_status_page_url?: InputMaybe<Scalars['String']['input']>;
  autofill_enabled?: InputMaybe<Scalars['Boolean']['input']>;
  brand_story?: InputMaybe<Scalars['JSON']['input']>;
  business_registration_number?: InputMaybe<Scalars['String']['input']>;
  cancellation_policy?: InputMaybe<Scalars['JSON']['input']>;
  career_info?: InputMaybe<Scalars['JSON']['input']>;
  category_code_rules?: InputMaybe<Scalars['String']['input']>;
  contact_email?: InputMaybe<Scalars['String']['input']>;
  customer_support_phone?: InputMaybe<Scalars['String']['input']>;
  data_protection_policy?: InputMaybe<Scalars['JSON']['input']>;
  default_backorder_allowed?: InputMaybe<Scalars['Boolean']['input']>;
  default_currency?: InputMaybe<Enum_Globalsetting_Default_Currency>;
  default_meta_description?: InputMaybe<Scalars['JSON']['input']>;
  default_meta_title?: InputMaybe<Scalars['String']['input']>;
  default_reorder_level?: InputMaybe<Scalars['Int']['input']>;
  default_tax_rate?: InputMaybe<Scalars['Float']['input']>;
  default_warehouse_location?: InputMaybe<Enum_Globalsetting_Default_Warehouse_Location>;
  digital_wallet_policy?: InputMaybe<Scalars['JSON']['input']>;
  discount_policy?: InputMaybe<Scalars['JSON']['input']>;
  facebook_url?: InputMaybe<Scalars['String']['input']>;
  faq_url?: InputMaybe<Scalars['String']['input']>;
  gift_card_policy?: InputMaybe<Scalars['JSON']['input']>;
  google_analytics_id?: InputMaybe<Scalars['String']['input']>;
  instagram_url?: InputMaybe<Scalars['String']['input']>;
  legal_disclaimer?: InputMaybe<Scalars['JSON']['input']>;
  live_chat_enabled?: InputMaybe<Scalars['Boolean']['input']>;
  loyalty_program_info?: InputMaybe<Scalars['JSON']['input']>;
  maintenance_mode?: InputMaybe<Scalars['Boolean']['input']>;
  mobile_app_download_url?: InputMaybe<Scalars['String']['input']>;
  newsletter_signup_url?: InputMaybe<Scalars['String']['input']>;
  operating_hours?: InputMaybe<Scalars['String']['input']>;
  order_policy?: InputMaybe<Scalars['JSON']['input']>;
  payment_policy?: InputMaybe<Scalars['JSON']['input']>;
  privacy_policy?: InputMaybe<Scalars['JSON']['input']>;
  publishedAt?: InputMaybe<Scalars['DateTime']['input']>;
  redeem_policy?: InputMaybe<Scalars['JSON']['input']>;
  refund_policy?: InputMaybe<Scalars['JSON']['input']>;
  return_and_exchange_policy?: InputMaybe<Scalars['JSON']['input']>;
  shipping_policy?: InputMaybe<Scalars['JSON']['input']>;
  site_launch_date?: InputMaybe<Scalars['DateTime']['input']>;
  sitemap_url?: InputMaybe<Scalars['String']['input']>;
  sku_format?: InputMaybe<Scalars['String']['input']>;
  store_location_google_map?: InputMaybe<Scalars['String']['input']>;
  supplier_policy?: InputMaybe<Scalars['JSON']['input']>;
  support_hours?: InputMaybe<Scalars['String']['input']>;
  terms_and_conditions?: InputMaybe<Scalars['JSON']['input']>;
  twitter_url?: InputMaybe<Scalars['String']['input']>;
  voucher_policy?: InputMaybe<Scalars['JSON']['input']>;
  whatsapp_support_number?: InputMaybe<Scalars['String']['input']>;
  youtube_url?: InputMaybe<Scalars['String']['input']>;
};

export type Homepage = {
  __typename: 'Homepage';
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  hero_slides?: Maybe<Array<Maybe<ComponentSectionsHeroSlides1>>>;
  hero_slides_1?: Maybe<Array<Maybe<ComponentSectionsHeroSlides1>>>;
  hero_slides_2?: Maybe<Array<Maybe<ComponentSectionsHeroSlides1>>>;
  hero_slides_3?: Maybe<Array<Maybe<ComponentSectionsHeroSlides1>>>;
  hero_slides_4?: Maybe<Array<Maybe<ComponentSectionsHeroSlides1>>>;
  hero_slides_5?: Maybe<Array<Maybe<ComponentSectionsHeroSlides1>>>;
  hero_slides_6?: Maybe<Array<Maybe<ComponentSectionsHeroSlides1>>>;
  hero_slides_7?: Maybe<Array<Maybe<ComponentSectionsHeroSlides1>>>;
  hero_slides_8?: Maybe<Array<Maybe<ComponentSectionsHeroSlides1>>>;
  hero_slides_9?: Maybe<Array<Maybe<ComponentSectionsHeroSlides1>>>;
  hero_slides_10?: Maybe<Array<Maybe<ComponentSectionsHeroSlides1>>>;
  hero_slides_11?: Maybe<Array<Maybe<ComponentSectionsHeroSlides1>>>;
  promo_bar?: Maybe<Array<Maybe<ComponentSectionsPromoBar>>>;
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};


export type HomepageHero_SlidesArgs = {
  filters?: InputMaybe<ComponentSectionsHeroSlides1FiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type HomepageHero_Slides_1Args = {
  filters?: InputMaybe<ComponentSectionsHeroSlides1FiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type HomepageHero_Slides_2Args = {
  filters?: InputMaybe<ComponentSectionsHeroSlides1FiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type HomepageHero_Slides_3Args = {
  filters?: InputMaybe<ComponentSectionsHeroSlides1FiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type HomepageHero_Slides_4Args = {
  filters?: InputMaybe<ComponentSectionsHeroSlides1FiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type HomepageHero_Slides_5Args = {
  filters?: InputMaybe<ComponentSectionsHeroSlides1FiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type HomepageHero_Slides_6Args = {
  filters?: InputMaybe<ComponentSectionsHeroSlides1FiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type HomepageHero_Slides_7Args = {
  filters?: InputMaybe<ComponentSectionsHeroSlides1FiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type HomepageHero_Slides_8Args = {
  filters?: InputMaybe<ComponentSectionsHeroSlides1FiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type HomepageHero_Slides_9Args = {
  filters?: InputMaybe<ComponentSectionsHeroSlides1FiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type HomepageHero_Slides_10Args = {
  filters?: InputMaybe<ComponentSectionsHeroSlides1FiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type HomepageHero_Slides_11Args = {
  filters?: InputMaybe<ComponentSectionsHeroSlides1FiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type HomepagePromo_BarArgs = {
  filters?: InputMaybe<ComponentSectionsPromoBarFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};

export type HomepageEntity = {
  __typename: 'HomepageEntity';
  attributes?: Maybe<Homepage>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type HomepageEntityResponse = {
  __typename: 'HomepageEntityResponse';
  data?: Maybe<HomepageEntity>;
};

export type HomepageInput = {
  hero_slides?: InputMaybe<Array<InputMaybe<ComponentSectionsHeroSlides1Input>>>;
  hero_slides_1?: InputMaybe<Array<InputMaybe<ComponentSectionsHeroSlides1Input>>>;
  hero_slides_2?: InputMaybe<Array<InputMaybe<ComponentSectionsHeroSlides1Input>>>;
  hero_slides_3?: InputMaybe<Array<InputMaybe<ComponentSectionsHeroSlides1Input>>>;
  hero_slides_4?: InputMaybe<Array<InputMaybe<ComponentSectionsHeroSlides1Input>>>;
  hero_slides_5?: InputMaybe<Array<InputMaybe<ComponentSectionsHeroSlides1Input>>>;
  hero_slides_6?: InputMaybe<Array<InputMaybe<ComponentSectionsHeroSlides1Input>>>;
  hero_slides_7?: InputMaybe<Array<InputMaybe<ComponentSectionsHeroSlides1Input>>>;
  hero_slides_8?: InputMaybe<Array<InputMaybe<ComponentSectionsHeroSlides1Input>>>;
  hero_slides_9?: InputMaybe<Array<InputMaybe<ComponentSectionsHeroSlides1Input>>>;
  hero_slides_10?: InputMaybe<Array<InputMaybe<ComponentSectionsHeroSlides1Input>>>;
  hero_slides_11?: InputMaybe<Array<InputMaybe<ComponentSectionsHeroSlides1Input>>>;
  promo_bar?: InputMaybe<Array<InputMaybe<ComponentSectionsPromoBarInput>>>;
  publishedAt?: InputMaybe<Scalars['DateTime']['input']>;
};

export type IdFilterInput = {
  and?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  between?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  contains?: InputMaybe<Scalars['ID']['input']>;
  containsi?: InputMaybe<Scalars['ID']['input']>;
  endsWith?: InputMaybe<Scalars['ID']['input']>;
  eq?: InputMaybe<Scalars['ID']['input']>;
  eqi?: InputMaybe<Scalars['ID']['input']>;
  gt?: InputMaybe<Scalars['ID']['input']>;
  gte?: InputMaybe<Scalars['ID']['input']>;
  in?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  lt?: InputMaybe<Scalars['ID']['input']>;
  lte?: InputMaybe<Scalars['ID']['input']>;
  ne?: InputMaybe<Scalars['ID']['input']>;
  nei?: InputMaybe<Scalars['ID']['input']>;
  not?: InputMaybe<IdFilterInput>;
  notContains?: InputMaybe<Scalars['ID']['input']>;
  notContainsi?: InputMaybe<Scalars['ID']['input']>;
  notIn?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  notNull?: InputMaybe<Scalars['Boolean']['input']>;
  null?: InputMaybe<Scalars['Boolean']['input']>;
  or?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  startsWith?: InputMaybe<Scalars['ID']['input']>;
};

export type IntFilterInput = {
  and?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>;
  between?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>;
  contains?: InputMaybe<Scalars['Int']['input']>;
  containsi?: InputMaybe<Scalars['Int']['input']>;
  endsWith?: InputMaybe<Scalars['Int']['input']>;
  eq?: InputMaybe<Scalars['Int']['input']>;
  eqi?: InputMaybe<Scalars['Int']['input']>;
  gt?: InputMaybe<Scalars['Int']['input']>;
  gte?: InputMaybe<Scalars['Int']['input']>;
  in?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>;
  lt?: InputMaybe<Scalars['Int']['input']>;
  lte?: InputMaybe<Scalars['Int']['input']>;
  ne?: InputMaybe<Scalars['Int']['input']>;
  nei?: InputMaybe<Scalars['Int']['input']>;
  not?: InputMaybe<IntFilterInput>;
  notContains?: InputMaybe<Scalars['Int']['input']>;
  notContainsi?: InputMaybe<Scalars['Int']['input']>;
  notIn?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>;
  notNull?: InputMaybe<Scalars['Boolean']['input']>;
  null?: InputMaybe<Scalars['Boolean']['input']>;
  or?: InputMaybe<Array<InputMaybe<Scalars['Int']['input']>>>;
  startsWith?: InputMaybe<Scalars['Int']['input']>;
};

export type JsonFilterInput = {
  and?: InputMaybe<Array<InputMaybe<Scalars['JSON']['input']>>>;
  between?: InputMaybe<Array<InputMaybe<Scalars['JSON']['input']>>>;
  contains?: InputMaybe<Scalars['JSON']['input']>;
  containsi?: InputMaybe<Scalars['JSON']['input']>;
  endsWith?: InputMaybe<Scalars['JSON']['input']>;
  eq?: InputMaybe<Scalars['JSON']['input']>;
  eqi?: InputMaybe<Scalars['JSON']['input']>;
  gt?: InputMaybe<Scalars['JSON']['input']>;
  gte?: InputMaybe<Scalars['JSON']['input']>;
  in?: InputMaybe<Array<InputMaybe<Scalars['JSON']['input']>>>;
  lt?: InputMaybe<Scalars['JSON']['input']>;
  lte?: InputMaybe<Scalars['JSON']['input']>;
  ne?: InputMaybe<Scalars['JSON']['input']>;
  nei?: InputMaybe<Scalars['JSON']['input']>;
  not?: InputMaybe<JsonFilterInput>;
  notContains?: InputMaybe<Scalars['JSON']['input']>;
  notContainsi?: InputMaybe<Scalars['JSON']['input']>;
  notIn?: InputMaybe<Array<InputMaybe<Scalars['JSON']['input']>>>;
  notNull?: InputMaybe<Scalars['Boolean']['input']>;
  null?: InputMaybe<Scalars['Boolean']['input']>;
  or?: InputMaybe<Array<InputMaybe<Scalars['JSON']['input']>>>;
  startsWith?: InputMaybe<Scalars['JSON']['input']>;
};

export type LongFilterInput = {
  and?: InputMaybe<Array<InputMaybe<Scalars['Long']['input']>>>;
  between?: InputMaybe<Array<InputMaybe<Scalars['Long']['input']>>>;
  contains?: InputMaybe<Scalars['Long']['input']>;
  containsi?: InputMaybe<Scalars['Long']['input']>;
  endsWith?: InputMaybe<Scalars['Long']['input']>;
  eq?: InputMaybe<Scalars['Long']['input']>;
  eqi?: InputMaybe<Scalars['Long']['input']>;
  gt?: InputMaybe<Scalars['Long']['input']>;
  gte?: InputMaybe<Scalars['Long']['input']>;
  in?: InputMaybe<Array<InputMaybe<Scalars['Long']['input']>>>;
  lt?: InputMaybe<Scalars['Long']['input']>;
  lte?: InputMaybe<Scalars['Long']['input']>;
  ne?: InputMaybe<Scalars['Long']['input']>;
  nei?: InputMaybe<Scalars['Long']['input']>;
  not?: InputMaybe<LongFilterInput>;
  notContains?: InputMaybe<Scalars['Long']['input']>;
  notContainsi?: InputMaybe<Scalars['Long']['input']>;
  notIn?: InputMaybe<Array<InputMaybe<Scalars['Long']['input']>>>;
  notNull?: InputMaybe<Scalars['Boolean']['input']>;
  null?: InputMaybe<Scalars['Boolean']['input']>;
  or?: InputMaybe<Array<InputMaybe<Scalars['Long']['input']>>>;
  startsWith?: InputMaybe<Scalars['Long']['input']>;
};

export type Loyaltypointhistory = {
  __typename: 'Loyaltypointhistory';
  activity?: Maybe<Scalars['String']['output']>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  date?: Maybe<Scalars['DateTime']['output']>;
  points?: Maybe<Scalars['Int']['output']>;
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
  users_permissions_user?: Maybe<UsersPermissionsUserEntityResponse>;
};

export type LoyaltypointhistoryEntity = {
  __typename: 'LoyaltypointhistoryEntity';
  attributes?: Maybe<Loyaltypointhistory>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type LoyaltypointhistoryEntityResponse = {
  __typename: 'LoyaltypointhistoryEntityResponse';
  data?: Maybe<LoyaltypointhistoryEntity>;
};

export type LoyaltypointhistoryInput = {
  activity?: InputMaybe<Scalars['String']['input']>;
  date?: InputMaybe<Scalars['DateTime']['input']>;
  points?: InputMaybe<Scalars['Int']['input']>;
  publishedAt?: InputMaybe<Scalars['DateTime']['input']>;
  users_permissions_user?: InputMaybe<Scalars['ID']['input']>;
};

export type Mutation = {
  __typename: 'Mutation';
  /** Change user password. Confirm with the current password. */
  changePassword?: Maybe<UsersPermissionsLoginPayload>;
  createAbout?: Maybe<AboutEntityResponse>;
  createAgeGroup?: Maybe<AgeGroupEntityResponse>;
  createArchiveRecord?: Maybe<ArchiveRecordEntityResponse>;
  createAudienceCategory?: Maybe<AudienceCategoryEntityResponse>;
  createBrandTier?: Maybe<BrandTierEntityResponse>;
  createCategory?: Maybe<CategoryEntityResponse>;
  createContact?: Maybe<ContactEntityResponse>;
  createEventsProductsCollection?: Maybe<EventsProductsCollectionEntityResponse>;
  createGenderGroup?: Maybe<GenderGroupEntityResponse>;
  createOrder?: Maybe<OrderEntityResponse>;
  createPolicy?: Maybe<PolicyEntityResponse>;
  createProduct?: Maybe<ProductEntityResponse>;
  createReferral?: Maybe<ReferralEntityResponse>;
  createReview?: Maybe<ReviewEntityResponse>;
  createTag?: Maybe<TagEntityResponse>;
  createUploadFile?: Maybe<UploadFileEntityResponse>;
  createUploadFolder?: Maybe<UploadFolderEntityResponse>;
  /** Create a new role */
  createUsersPermissionsRole?: Maybe<UsersPermissionsCreateRolePayload>;
  /** Create a new user */
  createUsersPermissionsUser: UsersPermissionsUserEntityResponse;
  deleteAbout?: Maybe<AboutEntityResponse>;
  deleteAgeGroup?: Maybe<AgeGroupEntityResponse>;
  deleteArchiveRecord?: Maybe<ArchiveRecordEntityResponse>;
  deleteAudienceCategory?: Maybe<AudienceCategoryEntityResponse>;
  deleteBrandTier?: Maybe<BrandTierEntityResponse>;
  deleteCategory?: Maybe<CategoryEntityResponse>;
  deleteContact?: Maybe<ContactEntityResponse>;
  deleteEventsProductsCollection?: Maybe<EventsProductsCollectionEntityResponse>;
  deleteGenderGroup?: Maybe<GenderGroupEntityResponse>;
  deleteGlobalSetting?: Maybe<GlobalSettingEntityResponse>;
  deleteHomepage?: Maybe<HomepageEntityResponse>;
  deleteLoyaltypointhistory?: Maybe<LoyaltypointhistoryEntityResponse>;
  deleteOrder?: Maybe<OrderEntityResponse>;
  deletePolicy?: Maybe<PolicyEntityResponse>;
  deleteProduct?: Maybe<ProductEntityResponse>;
  deleteReferral?: Maybe<ReferralEntityResponse>;
  deleteReview?: Maybe<ReviewEntityResponse>;
  deleteTag?: Maybe<TagEntityResponse>;
  deleteUploadFile?: Maybe<UploadFileEntityResponse>;
  deleteUploadFolder?: Maybe<UploadFolderEntityResponse>;
  /** Delete an existing role */
  deleteUsersPermissionsRole?: Maybe<UsersPermissionsDeleteRolePayload>;
  /** Delete an existing user */
  deleteUsersPermissionsUser: UsersPermissionsUserEntityResponse;
  /** Confirm an email users email address */
  emailConfirmation?: Maybe<UsersPermissionsLoginPayload>;
  /** Request a reset password token */
  forgotPassword?: Maybe<UsersPermissionsPasswordPayload>;
  login: UsersPermissionsLoginPayload;
  multipleUpload: Array<Maybe<UploadFileEntityResponse>>;
  /** Register a user */
  register: UsersPermissionsLoginPayload;
  removeFile?: Maybe<UploadFileEntityResponse>;
  /** Reset user password. Confirm with a code (resetToken from forgotPassword) */
  resetPassword?: Maybe<UsersPermissionsLoginPayload>;
  updateAbout?: Maybe<AboutEntityResponse>;
  updateAgeGroup?: Maybe<AgeGroupEntityResponse>;
  updateArchiveRecord?: Maybe<ArchiveRecordEntityResponse>;
  updateAudienceCategory?: Maybe<AudienceCategoryEntityResponse>;
  updateBrandTier?: Maybe<BrandTierEntityResponse>;
  updateCategory?: Maybe<CategoryEntityResponse>;
  updateContact?: Maybe<ContactEntityResponse>;
  updateEventsProductsCollection?: Maybe<EventsProductsCollectionEntityResponse>;
  updateFileInfo: UploadFileEntityResponse;
  updateGenderGroup?: Maybe<GenderGroupEntityResponse>;
  updateGlobalSetting?: Maybe<GlobalSettingEntityResponse>;
  updateHomepage?: Maybe<HomepageEntityResponse>;
  updateLoyaltypointhistory?: Maybe<LoyaltypointhistoryEntityResponse>;
  updateOrder?: Maybe<OrderEntityResponse>;
  updatePolicy?: Maybe<PolicyEntityResponse>;
  updateProduct?: Maybe<ProductEntityResponse>;
  updateReferral?: Maybe<ReferralEntityResponse>;
  updateReview?: Maybe<ReviewEntityResponse>;
  updateTag?: Maybe<TagEntityResponse>;
  updateUploadFile?: Maybe<UploadFileEntityResponse>;
  updateUploadFolder?: Maybe<UploadFolderEntityResponse>;
  /** Update an existing role */
  updateUsersPermissionsRole?: Maybe<UsersPermissionsUpdateRolePayload>;
  /** Update an existing user */
  updateUsersPermissionsUser: UsersPermissionsUserEntityResponse;
  upload: UploadFileEntityResponse;
};


export type MutationChangePasswordArgs = {
  currentPassword: Scalars['String']['input'];
  password: Scalars['String']['input'];
  passwordConfirmation: Scalars['String']['input'];
};


export type MutationCreateAboutArgs = {
  data: AboutInput;
};


export type MutationCreateAgeGroupArgs = {
  data: AgeGroupInput;
};


export type MutationCreateArchiveRecordArgs = {
  data: ArchiveRecordInput;
};


export type MutationCreateAudienceCategoryArgs = {
  data: AudienceCategoryInput;
};


export type MutationCreateBrandTierArgs = {
  data: BrandTierInput;
};


export type MutationCreateCategoryArgs = {
  data: CategoryInput;
};


export type MutationCreateContactArgs = {
  data: ContactInput;
};


export type MutationCreateEventsProductsCollectionArgs = {
  data: EventsProductsCollectionInput;
};


export type MutationCreateGenderGroupArgs = {
  data: GenderGroupInput;
};


export type MutationCreateOrderArgs = {
  data: OrderInput;
};


export type MutationCreatePolicyArgs = {
  data: PolicyInput;
};


export type MutationCreateProductArgs = {
  data: ProductInput;
};


export type MutationCreateReferralArgs = {
  data: ReferralInput;
};


export type MutationCreateReviewArgs = {
  data: ReviewInput;
};


export type MutationCreateTagArgs = {
  data: TagInput;
};


export type MutationCreateUploadFileArgs = {
  data: UploadFileInput;
};


export type MutationCreateUploadFolderArgs = {
  data: UploadFolderInput;
};


export type MutationCreateUsersPermissionsRoleArgs = {
  data: UsersPermissionsRoleInput;
};


export type MutationCreateUsersPermissionsUserArgs = {
  data: UsersPermissionsUserInput;
};


export type MutationDeleteAboutArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteAgeGroupArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteArchiveRecordArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteAudienceCategoryArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteBrandTierArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteCategoryArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteContactArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteEventsProductsCollectionArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteGenderGroupArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteOrderArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeletePolicyArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteProductArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteReferralArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteReviewArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteTagArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteUploadFileArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteUploadFolderArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteUsersPermissionsRoleArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteUsersPermissionsUserArgs = {
  id: Scalars['ID']['input'];
};


export type MutationEmailConfirmationArgs = {
  confirmation: Scalars['String']['input'];
};


export type MutationForgotPasswordArgs = {
  email: Scalars['String']['input'];
};


export type MutationLoginArgs = {
  input: UsersPermissionsLoginInput;
};


export type MutationMultipleUploadArgs = {
  field?: InputMaybe<Scalars['String']['input']>;
  files: Array<InputMaybe<Scalars['Upload']['input']>>;
  ref?: InputMaybe<Scalars['String']['input']>;
  refId?: InputMaybe<Scalars['ID']['input']>;
};


export type MutationRegisterArgs = {
  input: UsersPermissionsRegisterInput;
};


export type MutationRemoveFileArgs = {
  id: Scalars['ID']['input'];
};


export type MutationResetPasswordArgs = {
  code: Scalars['String']['input'];
  password: Scalars['String']['input'];
  passwordConfirmation: Scalars['String']['input'];
};


export type MutationUpdateAboutArgs = {
  data: AboutInput;
  id: Scalars['ID']['input'];
};


export type MutationUpdateAgeGroupArgs = {
  data: AgeGroupInput;
  id: Scalars['ID']['input'];
};


export type MutationUpdateArchiveRecordArgs = {
  data: ArchiveRecordInput;
  id: Scalars['ID']['input'];
};


export type MutationUpdateAudienceCategoryArgs = {
  data: AudienceCategoryInput;
  id: Scalars['ID']['input'];
};


export type MutationUpdateBrandTierArgs = {
  data: BrandTierInput;
  id: Scalars['ID']['input'];
};


export type MutationUpdateCategoryArgs = {
  data: CategoryInput;
  id: Scalars['ID']['input'];
};


export type MutationUpdateContactArgs = {
  data: ContactInput;
  id: Scalars['ID']['input'];
};


export type MutationUpdateEventsProductsCollectionArgs = {
  data: EventsProductsCollectionInput;
  id: Scalars['ID']['input'];
};


export type MutationUpdateFileInfoArgs = {
  id: Scalars['ID']['input'];
  info?: InputMaybe<FileInfoInput>;
};


export type MutationUpdateGenderGroupArgs = {
  data: GenderGroupInput;
  id: Scalars['ID']['input'];
};


export type MutationUpdateGlobalSettingArgs = {
  data: GlobalSettingInput;
};


export type MutationUpdateHomepageArgs = {
  data: HomepageInput;
};


export type MutationUpdateLoyaltypointhistoryArgs = {
  data: LoyaltypointhistoryInput;
};


export type MutationUpdateOrderArgs = {
  data: OrderInput;
  id: Scalars['ID']['input'];
};


export type MutationUpdatePolicyArgs = {
  data: PolicyInput;
  id: Scalars['ID']['input'];
};


export type MutationUpdateProductArgs = {
  data: ProductInput;
  id: Scalars['ID']['input'];
};


export type MutationUpdateReferralArgs = {
  data: ReferralInput;
  id: Scalars['ID']['input'];
};


export type MutationUpdateReviewArgs = {
  data: ReviewInput;
  id: Scalars['ID']['input'];
};


export type MutationUpdateTagArgs = {
  data: TagInput;
  id: Scalars['ID']['input'];
};


export type MutationUpdateUploadFileArgs = {
  data: UploadFileInput;
  id: Scalars['ID']['input'];
};


export type MutationUpdateUploadFolderArgs = {
  data: UploadFolderInput;
  id: Scalars['ID']['input'];
};


export type MutationUpdateUsersPermissionsRoleArgs = {
  data: UsersPermissionsRoleInput;
  id: Scalars['ID']['input'];
};


export type MutationUpdateUsersPermissionsUserArgs = {
  data: UsersPermissionsUserInput;
  id: Scalars['ID']['input'];
};


export type MutationUploadArgs = {
  field?: InputMaybe<Scalars['String']['input']>;
  file: Scalars['Upload']['input'];
  info?: InputMaybe<FileInfoInput>;
  ref?: InputMaybe<Scalars['String']['input']>;
  refId?: InputMaybe<Scalars['ID']['input']>;
};

export type Order = {
  __typename: 'Order';
  archive_record?: Maybe<ArchiveRecordEntityResponse>;
  billing_address?: Maybe<Array<Maybe<ComponentOrderComponentsAddressSnapshot>>>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  invoice_url?: Maybe<UploadFileEntityResponse>;
  order_id?: Maybe<Scalars['String']['output']>;
  payment_method?: Maybe<Enum_Order_Payment_Method>;
  payment_status?: Maybe<Enum_Order_Payment_Status>;
  placed_at?: Maybe<Scalars['DateTime']['output']>;
  product_items?: Maybe<Array<Maybe<ComponentOrderComponentsProductItems>>>;
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  shipping_address?: Maybe<ComponentOrderComponentsAddressSnapshot>;
  status?: Maybe<Enum_Order_Status>;
  total_amount?: Maybe<Scalars['Float']['output']>;
  transaction_id?: Maybe<Scalars['String']['output']>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
  user?: Maybe<UsersPermissionsUserEntityResponse>;
};


export type OrderBilling_AddressArgs = {
  filters?: InputMaybe<ComponentOrderComponentsAddressSnapshotFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type OrderProduct_ItemsArgs = {
  filters?: InputMaybe<ComponentOrderComponentsProductItemsFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};

export type OrderEntity = {
  __typename: 'OrderEntity';
  attributes?: Maybe<Order>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type OrderEntityResponse = {
  __typename: 'OrderEntityResponse';
  data?: Maybe<OrderEntity>;
};

export type OrderEntityResponseCollection = {
  __typename: 'OrderEntityResponseCollection';
  data: Array<OrderEntity>;
  meta: ResponseCollectionMeta;
};

export type OrderFiltersInput = {
  and?: InputMaybe<Array<InputMaybe<OrderFiltersInput>>>;
  archive_record?: InputMaybe<ArchiveRecordFiltersInput>;
  billing_address?: InputMaybe<ComponentOrderComponentsAddressSnapshotFiltersInput>;
  createdAt?: InputMaybe<DateTimeFilterInput>;
  id?: InputMaybe<IdFilterInput>;
  not?: InputMaybe<OrderFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<OrderFiltersInput>>>;
  order_id?: InputMaybe<StringFilterInput>;
  payment_method?: InputMaybe<StringFilterInput>;
  payment_status?: InputMaybe<StringFilterInput>;
  placed_at?: InputMaybe<DateTimeFilterInput>;
  product_items?: InputMaybe<ComponentOrderComponentsProductItemsFiltersInput>;
  publishedAt?: InputMaybe<DateTimeFilterInput>;
  shipping_address?: InputMaybe<ComponentOrderComponentsAddressSnapshotFiltersInput>;
  status?: InputMaybe<StringFilterInput>;
  total_amount?: InputMaybe<FloatFilterInput>;
  transaction_id?: InputMaybe<StringFilterInput>;
  updatedAt?: InputMaybe<DateTimeFilterInput>;
  user?: InputMaybe<UsersPermissionsUserFiltersInput>;
};

export type OrderInput = {
  archive_record?: InputMaybe<Scalars['ID']['input']>;
  billing_address?: InputMaybe<Array<InputMaybe<ComponentOrderComponentsAddressSnapshotInput>>>;
  invoice_url?: InputMaybe<Scalars['ID']['input']>;
  order_id?: InputMaybe<Scalars['String']['input']>;
  payment_method?: InputMaybe<Enum_Order_Payment_Method>;
  payment_status?: InputMaybe<Enum_Order_Payment_Status>;
  placed_at?: InputMaybe<Scalars['DateTime']['input']>;
  product_items?: InputMaybe<Array<InputMaybe<ComponentOrderComponentsProductItemsInput>>>;
  publishedAt?: InputMaybe<Scalars['DateTime']['input']>;
  shipping_address?: InputMaybe<ComponentOrderComponentsAddressSnapshotInput>;
  status?: InputMaybe<Enum_Order_Status>;
  total_amount?: InputMaybe<Scalars['Float']['input']>;
  transaction_id?: InputMaybe<Scalars['String']['input']>;
  user?: InputMaybe<Scalars['ID']['input']>;
};

export type OrderRelationResponseCollection = {
  __typename: 'OrderRelationResponseCollection';
  data: Array<OrderEntity>;
};

export type Pagination = {
  __typename: 'Pagination';
  page: Scalars['Int']['output'];
  pageCount: Scalars['Int']['output'];
  pageSize: Scalars['Int']['output'];
  total: Scalars['Int']['output'];
};

export type PaginationArg = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  page?: InputMaybe<Scalars['Int']['input']>;
  pageSize?: InputMaybe<Scalars['Int']['input']>;
  start?: InputMaybe<Scalars['Int']['input']>;
};

export type Policy = {
  __typename: 'Policy';
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  description?: Maybe<Scalars['JSON']['output']>;
  is_active?: Maybe<Scalars['Boolean']['output']>;
  last_updated_by_personnel?: Maybe<Scalars['DateTime']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  slug?: Maybe<Scalars['String']['output']>;
  title?: Maybe<Enum_Policy_Title>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};

export type PolicyEntity = {
  __typename: 'PolicyEntity';
  attributes?: Maybe<Policy>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type PolicyEntityResponse = {
  __typename: 'PolicyEntityResponse';
  data?: Maybe<PolicyEntity>;
};

export type PolicyEntityResponseCollection = {
  __typename: 'PolicyEntityResponseCollection';
  data: Array<PolicyEntity>;
  meta: ResponseCollectionMeta;
};

export type PolicyFiltersInput = {
  and?: InputMaybe<Array<InputMaybe<PolicyFiltersInput>>>;
  createdAt?: InputMaybe<DateTimeFilterInput>;
  description?: InputMaybe<JsonFilterInput>;
  id?: InputMaybe<IdFilterInput>;
  is_active?: InputMaybe<BooleanFilterInput>;
  last_updated_by_personnel?: InputMaybe<DateTimeFilterInput>;
  name?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<PolicyFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<PolicyFiltersInput>>>;
  publishedAt?: InputMaybe<DateTimeFilterInput>;
  slug?: InputMaybe<StringFilterInput>;
  title?: InputMaybe<StringFilterInput>;
  updatedAt?: InputMaybe<DateTimeFilterInput>;
};

export type PolicyInput = {
  description?: InputMaybe<Scalars['JSON']['input']>;
  is_active?: InputMaybe<Scalars['Boolean']['input']>;
  last_updated_by_personnel?: InputMaybe<Scalars['DateTime']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  publishedAt?: InputMaybe<Scalars['DateTime']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Enum_Policy_Title>;
};

export type Product = {
  __typename: 'Product';
  age_groups?: Maybe<AgeGroupRelationResponseCollection>;
  archive_record?: Maybe<ArchiveRecordEntityResponse>;
  audience_categories?: Maybe<AudienceCategoryRelationResponseCollection>;
  audit_log?: Maybe<Scalars['JSON']['output']>;
  available?: Maybe<Scalars['Boolean']['output']>;
  base_sku?: Maybe<Scalars['String']['output']>;
  brand_tiers?: Maybe<BrandTierRelationResponseCollection>;
  care_instructions?: Maybe<Scalars['JSON']['output']>;
  categories?: Maybe<CategoryRelationResponseCollection>;
  cost_price?: Maybe<Scalars['Long']['output']>;
  country_of_origin?: Maybe<Scalars['String']['output']>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  description?: Maybe<Scalars['JSON']['output']>;
  disable_frontend?: Maybe<Scalars['Boolean']['output']>;
  estimated_delivery?: Maybe<Scalars['String']['output']>;
  events_products_collections?: Maybe<EventsProductsCollectionRelationResponseCollection>;
  fit_type?: Maybe<Enum_Product_Fit_Type>;
  gallery_videos?: Maybe<UploadFileEntityResponse>;
  gender_groups?: Maybe<GenderGroupRelationResponseCollection>;
  internal_notes?: Maybe<Scalars['String']['output']>;
  is_archived?: Maybe<Scalars['Boolean']['output']>;
  is_featured?: Maybe<Scalars['Boolean']['output']>;
  meta_description?: Maybe<Scalars['String']['output']>;
  model_info?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  og_image_Social_Media?: Maybe<UploadFileEntityResponse>;
  preorder?: Maybe<Scalars['Boolean']['output']>;
  preorder_eta?: Maybe<Scalars['DateTime']['output']>;
  preorder_note?: Maybe<Scalars['String']['output']>;
  product_code?: Maybe<Scalars['String']['output']>;
  product_history?: Maybe<Scalars['JSON']['output']>;
  product_id?: Maybe<ComponentProductDetailsProductIdentity>;
  product_variant?: Maybe<Array<Maybe<ComponentVariantProductVariant>>>;
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  review_count?: Maybe<Scalars['Int']['output']>;
  reviews?: Maybe<ReviewRelationResponseCollection>;
  seo_keywords?: Maybe<Scalars['String']['output']>;
  short_description?: Maybe<Scalars['String']['output']>;
  size_guide_url?: Maybe<Scalars['String']['output']>;
  slug?: Maybe<Scalars['String']['output']>;
  supplier?: Maybe<Scalars['String']['output']>;
  supplier_contact?: Maybe<Scalars['JSON']['output']>;
  tags?: Maybe<TagRelationResponseCollection>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};


export type ProductAge_GroupsArgs = {
  filters?: InputMaybe<AgeGroupFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type ProductAudience_CategoriesArgs = {
  filters?: InputMaybe<AudienceCategoryFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type ProductBrand_TiersArgs = {
  filters?: InputMaybe<BrandTierFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type ProductCategoriesArgs = {
  filters?: InputMaybe<CategoryFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type ProductEvents_Products_CollectionsArgs = {
  filters?: InputMaybe<EventsProductsCollectionFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type ProductGender_GroupsArgs = {
  filters?: InputMaybe<GenderGroupFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type ProductProduct_VariantArgs = {
  filters?: InputMaybe<ComponentVariantProductVariantFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type ProductReviewsArgs = {
  filters?: InputMaybe<ReviewFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type ProductTagsArgs = {
  filters?: InputMaybe<TagFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};

export type ProductEntity = {
  __typename: 'ProductEntity';
  attributes?: Maybe<Product>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type ProductEntityResponse = {
  __typename: 'ProductEntityResponse';
  data?: Maybe<ProductEntity>;
};

export type ProductEntityResponseCollection = {
  __typename: 'ProductEntityResponseCollection';
  data: Array<ProductEntity>;
  meta: ResponseCollectionMeta;
};

export type ProductFiltersInput = {
  age_groups?: InputMaybe<AgeGroupFiltersInput>;
  and?: InputMaybe<Array<InputMaybe<ProductFiltersInput>>>;
  archive_record?: InputMaybe<ArchiveRecordFiltersInput>;
  audience_categories?: InputMaybe<AudienceCategoryFiltersInput>;
  audit_log?: InputMaybe<JsonFilterInput>;
  available?: InputMaybe<BooleanFilterInput>;
  base_sku?: InputMaybe<StringFilterInput>;
  brand_tiers?: InputMaybe<BrandTierFiltersInput>;
  care_instructions?: InputMaybe<JsonFilterInput>;
  categories?: InputMaybe<CategoryFiltersInput>;
  cost_price?: InputMaybe<LongFilterInput>;
  country_of_origin?: InputMaybe<StringFilterInput>;
  createdAt?: InputMaybe<DateTimeFilterInput>;
  description?: InputMaybe<JsonFilterInput>;
  disable_frontend?: InputMaybe<BooleanFilterInput>;
  estimated_delivery?: InputMaybe<StringFilterInput>;
  events_products_collections?: InputMaybe<EventsProductsCollectionFiltersInput>;
  fit_type?: InputMaybe<StringFilterInput>;
  gender_groups?: InputMaybe<GenderGroupFiltersInput>;
  id?: InputMaybe<IdFilterInput>;
  internal_notes?: InputMaybe<StringFilterInput>;
  is_archived?: InputMaybe<BooleanFilterInput>;
  is_featured?: InputMaybe<BooleanFilterInput>;
  meta_description?: InputMaybe<StringFilterInput>;
  model_info?: InputMaybe<StringFilterInput>;
  name?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<ProductFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<ProductFiltersInput>>>;
  preorder?: InputMaybe<BooleanFilterInput>;
  preorder_eta?: InputMaybe<DateTimeFilterInput>;
  preorder_note?: InputMaybe<StringFilterInput>;
  product_code?: InputMaybe<StringFilterInput>;
  product_history?: InputMaybe<JsonFilterInput>;
  product_id?: InputMaybe<ComponentProductDetailsProductIdentityFiltersInput>;
  product_variant?: InputMaybe<ComponentVariantProductVariantFiltersInput>;
  publishedAt?: InputMaybe<DateTimeFilterInput>;
  review_count?: InputMaybe<IntFilterInput>;
  reviews?: InputMaybe<ReviewFiltersInput>;
  seo_keywords?: InputMaybe<StringFilterInput>;
  short_description?: InputMaybe<StringFilterInput>;
  size_guide_url?: InputMaybe<StringFilterInput>;
  slug?: InputMaybe<StringFilterInput>;
  supplier?: InputMaybe<StringFilterInput>;
  supplier_contact?: InputMaybe<JsonFilterInput>;
  tags?: InputMaybe<TagFiltersInput>;
  updatedAt?: InputMaybe<DateTimeFilterInput>;
};

export type ProductInput = {
  age_groups?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  archive_record?: InputMaybe<Scalars['ID']['input']>;
  audience_categories?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  audit_log?: InputMaybe<Scalars['JSON']['input']>;
  available?: InputMaybe<Scalars['Boolean']['input']>;
  base_sku?: InputMaybe<Scalars['String']['input']>;
  brand_tiers?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  care_instructions?: InputMaybe<Scalars['JSON']['input']>;
  categories?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  cost_price?: InputMaybe<Scalars['Long']['input']>;
  country_of_origin?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['JSON']['input']>;
  disable_frontend?: InputMaybe<Scalars['Boolean']['input']>;
  estimated_delivery?: InputMaybe<Scalars['String']['input']>;
  events_products_collections?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  fit_type?: InputMaybe<Enum_Product_Fit_Type>;
  gallery_videos?: InputMaybe<Scalars['ID']['input']>;
  gender_groups?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  internal_notes?: InputMaybe<Scalars['String']['input']>;
  is_archived?: InputMaybe<Scalars['Boolean']['input']>;
  is_featured?: InputMaybe<Scalars['Boolean']['input']>;
  meta_description?: InputMaybe<Scalars['String']['input']>;
  model_info?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  og_image_Social_Media?: InputMaybe<Scalars['ID']['input']>;
  preorder?: InputMaybe<Scalars['Boolean']['input']>;
  preorder_eta?: InputMaybe<Scalars['DateTime']['input']>;
  preorder_note?: InputMaybe<Scalars['String']['input']>;
  product_code?: InputMaybe<Scalars['String']['input']>;
  product_history?: InputMaybe<Scalars['JSON']['input']>;
  product_id?: InputMaybe<ComponentProductDetailsProductIdentityInput>;
  product_variant?: InputMaybe<Array<InputMaybe<ComponentVariantProductVariantInput>>>;
  publishedAt?: InputMaybe<Scalars['DateTime']['input']>;
  review_count?: InputMaybe<Scalars['Int']['input']>;
  reviews?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  seo_keywords?: InputMaybe<Scalars['String']['input']>;
  short_description?: InputMaybe<Scalars['String']['input']>;
  size_guide_url?: InputMaybe<Scalars['String']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
  supplier?: InputMaybe<Scalars['String']['input']>;
  supplier_contact?: InputMaybe<Scalars['JSON']['input']>;
  tags?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
};

export type ProductRelationResponseCollection = {
  __typename: 'ProductRelationResponseCollection';
  data: Array<ProductEntity>;
};

export enum PublicationState {
  Live = 'LIVE',
  Preview = 'PREVIEW'
}

export type Query = {
  __typename: 'Query';
  about?: Maybe<AboutEntityResponse>;
  abouts?: Maybe<AboutEntityResponseCollection>;
  ageGroup?: Maybe<AgeGroupEntityResponse>;
  ageGroups?: Maybe<AgeGroupEntityResponseCollection>;
  archiveRecord?: Maybe<ArchiveRecordEntityResponse>;
  archiveRecords?: Maybe<ArchiveRecordEntityResponseCollection>;
  audienceCategories?: Maybe<AudienceCategoryEntityResponseCollection>;
  audienceCategory?: Maybe<AudienceCategoryEntityResponse>;
  brandTier?: Maybe<BrandTierEntityResponse>;
  brandTiers?: Maybe<BrandTierEntityResponseCollection>;
  categories?: Maybe<CategoryEntityResponseCollection>;
  category?: Maybe<CategoryEntityResponse>;
  contact?: Maybe<ContactEntityResponse>;
  contacts?: Maybe<ContactEntityResponseCollection>;
  eventsProductsCollection?: Maybe<EventsProductsCollectionEntityResponse>;
  eventsProductsCollections?: Maybe<EventsProductsCollectionEntityResponseCollection>;
  genderGroup?: Maybe<GenderGroupEntityResponse>;
  genderGroups?: Maybe<GenderGroupEntityResponseCollection>;
  globalSetting?: Maybe<GlobalSettingEntityResponse>;
  homepage?: Maybe<HomepageEntityResponse>;
  loyaltypointhistory?: Maybe<LoyaltypointhistoryEntityResponse>;
  me?: Maybe<UsersPermissionsMe>;
  order?: Maybe<OrderEntityResponse>;
  orders?: Maybe<OrderEntityResponseCollection>;
  policies?: Maybe<PolicyEntityResponseCollection>;
  policy?: Maybe<PolicyEntityResponse>;
  product?: Maybe<ProductEntityResponse>;
  products?: Maybe<ProductEntityResponseCollection>;
  referral?: Maybe<ReferralEntityResponse>;
  referrals?: Maybe<ReferralEntityResponseCollection>;
  review?: Maybe<ReviewEntityResponse>;
  reviews?: Maybe<ReviewEntityResponseCollection>;
  tag?: Maybe<TagEntityResponse>;
  tags?: Maybe<TagEntityResponseCollection>;
  uploadFile?: Maybe<UploadFileEntityResponse>;
  uploadFiles?: Maybe<UploadFileEntityResponseCollection>;
  uploadFolder?: Maybe<UploadFolderEntityResponse>;
  uploadFolders?: Maybe<UploadFolderEntityResponseCollection>;
  usersPermissionsRole?: Maybe<UsersPermissionsRoleEntityResponse>;
  usersPermissionsRoles?: Maybe<UsersPermissionsRoleEntityResponseCollection>;
  usersPermissionsUser?: Maybe<UsersPermissionsUserEntityResponse>;
  usersPermissionsUsers?: Maybe<UsersPermissionsUserEntityResponseCollection>;
};


export type QueryAboutArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryAboutsArgs = {
  filters?: InputMaybe<AboutFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type QueryAgeGroupArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryAgeGroupsArgs = {
  filters?: InputMaybe<AgeGroupFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type QueryArchiveRecordArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryArchiveRecordsArgs = {
  filters?: InputMaybe<ArchiveRecordFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type QueryAudienceCategoriesArgs = {
  filters?: InputMaybe<AudienceCategoryFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type QueryAudienceCategoryArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryBrandTierArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryBrandTiersArgs = {
  filters?: InputMaybe<BrandTierFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type QueryCategoriesArgs = {
  filters?: InputMaybe<CategoryFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type QueryCategoryArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryContactArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryContactsArgs = {
  filters?: InputMaybe<ContactFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type QueryEventsProductsCollectionArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryEventsProductsCollectionsArgs = {
  filters?: InputMaybe<EventsProductsCollectionFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type QueryGenderGroupArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryGenderGroupsArgs = {
  filters?: InputMaybe<GenderGroupFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type QueryGlobalSettingArgs = {
  publicationState?: InputMaybe<PublicationState>;
};


export type QueryHomepageArgs = {
  publicationState?: InputMaybe<PublicationState>;
};


export type QueryLoyaltypointhistoryArgs = {
  publicationState?: InputMaybe<PublicationState>;
};


export type QueryOrderArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryOrdersArgs = {
  filters?: InputMaybe<OrderFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type QueryPoliciesArgs = {
  filters?: InputMaybe<PolicyFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type QueryPolicyArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryProductArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryProductsArgs = {
  filters?: InputMaybe<ProductFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type QueryReferralArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryReferralsArgs = {
  filters?: InputMaybe<ReferralFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type QueryReviewArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryReviewsArgs = {
  filters?: InputMaybe<ReviewFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type QueryTagArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryTagsArgs = {
  filters?: InputMaybe<TagFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type QueryUploadFileArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryUploadFilesArgs = {
  filters?: InputMaybe<UploadFileFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type QueryUploadFolderArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryUploadFoldersArgs = {
  filters?: InputMaybe<UploadFolderFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type QueryUsersPermissionsRoleArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryUsersPermissionsRolesArgs = {
  filters?: InputMaybe<UsersPermissionsRoleFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type QueryUsersPermissionsUserArgs = {
  id?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryUsersPermissionsUsersArgs = {
  filters?: InputMaybe<UsersPermissionsUserFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};

export type Referral = {
  __typename: 'Referral';
  add_activated_at?: Maybe<Scalars['DateTime']['output']>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  is_redeemed?: Maybe<Scalars['Boolean']['output']>;
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  referrer?: Maybe<UsersPermissionsUserEntityResponse>;
  reffered?: Maybe<UsersPermissionsUserEntityResponse>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};

export type ReferralEntity = {
  __typename: 'ReferralEntity';
  attributes?: Maybe<Referral>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type ReferralEntityResponse = {
  __typename: 'ReferralEntityResponse';
  data?: Maybe<ReferralEntity>;
};

export type ReferralEntityResponseCollection = {
  __typename: 'ReferralEntityResponseCollection';
  data: Array<ReferralEntity>;
  meta: ResponseCollectionMeta;
};

export type ReferralFiltersInput = {
  add_activated_at?: InputMaybe<DateTimeFilterInput>;
  and?: InputMaybe<Array<InputMaybe<ReferralFiltersInput>>>;
  createdAt?: InputMaybe<DateTimeFilterInput>;
  id?: InputMaybe<IdFilterInput>;
  is_redeemed?: InputMaybe<BooleanFilterInput>;
  not?: InputMaybe<ReferralFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<ReferralFiltersInput>>>;
  publishedAt?: InputMaybe<DateTimeFilterInput>;
  referrer?: InputMaybe<UsersPermissionsUserFiltersInput>;
  reffered?: InputMaybe<UsersPermissionsUserFiltersInput>;
  updatedAt?: InputMaybe<DateTimeFilterInput>;
};

export type ReferralInput = {
  add_activated_at?: InputMaybe<Scalars['DateTime']['input']>;
  is_redeemed?: InputMaybe<Scalars['Boolean']['input']>;
  publishedAt?: InputMaybe<Scalars['DateTime']['input']>;
  referrer?: InputMaybe<Scalars['ID']['input']>;
  reffered?: InputMaybe<Scalars['ID']['input']>;
};

export type ReferralRelationResponseCollection = {
  __typename: 'ReferralRelationResponseCollection';
  data: Array<ReferralEntity>;
};

export type ResponseCollectionMeta = {
  __typename: 'ResponseCollectionMeta';
  pagination: Pagination;
};

export type Review = {
  __typename: 'Review';
  approved?: Maybe<Scalars['Boolean']['output']>;
  archive_date?: Maybe<Scalars['DateTime']['output']>;
  archive_reason?: Maybe<Enum_Review_Archive_Reason>;
  audit_log?: Maybe<Scalars['JSON']['output']>;
  author_name?: Maybe<Scalars['String']['output']>;
  comment?: Maybe<Scalars['JSON']['output']>;
  content?: Maybe<Scalars['String']['output']>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  flags?: Maybe<Scalars['Int']['output']>;
  helpful_count?: Maybe<Scalars['Int']['output']>;
  images?: Maybe<UploadFileRelationResponseCollection>;
  is_archived?: Maybe<Scalars['Boolean']['output']>;
  is_featured?: Maybe<Scalars['Boolean']['output']>;
  likes?: Maybe<Scalars['Long']['output']>;
  locale?: Maybe<Scalars['String']['output']>;
  product?: Maybe<ProductEntityResponse>;
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  rating?: Maybe<Enum_Review_Rating>;
  reply?: Maybe<Scalars['JSON']['output']>;
  response?: Maybe<Scalars['JSON']['output']>;
  reviewed_at?: Maybe<Scalars['DateTime']['output']>;
  status?: Maybe<Enum_Review_Status>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
  user?: Maybe<UsersPermissionsUserEntityResponse>;
  verified?: Maybe<Scalars['Boolean']['output']>;
  videos?: Maybe<UploadFileRelationResponseCollection>;
};


export type ReviewImagesArgs = {
  filters?: InputMaybe<UploadFileFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type ReviewVideosArgs = {
  filters?: InputMaybe<UploadFileFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};

export type ReviewEntity = {
  __typename: 'ReviewEntity';
  attributes?: Maybe<Review>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type ReviewEntityResponse = {
  __typename: 'ReviewEntityResponse';
  data?: Maybe<ReviewEntity>;
};

export type ReviewEntityResponseCollection = {
  __typename: 'ReviewEntityResponseCollection';
  data: Array<ReviewEntity>;
  meta: ResponseCollectionMeta;
};

export type ReviewFiltersInput = {
  and?: InputMaybe<Array<InputMaybe<ReviewFiltersInput>>>;
  approved?: InputMaybe<BooleanFilterInput>;
  archive_date?: InputMaybe<DateTimeFilterInput>;
  archive_reason?: InputMaybe<StringFilterInput>;
  audit_log?: InputMaybe<JsonFilterInput>;
  author_name?: InputMaybe<StringFilterInput>;
  comment?: InputMaybe<JsonFilterInput>;
  content?: InputMaybe<StringFilterInput>;
  createdAt?: InputMaybe<DateTimeFilterInput>;
  flags?: InputMaybe<IntFilterInput>;
  helpful_count?: InputMaybe<IntFilterInput>;
  id?: InputMaybe<IdFilterInput>;
  is_archived?: InputMaybe<BooleanFilterInput>;
  is_featured?: InputMaybe<BooleanFilterInput>;
  likes?: InputMaybe<LongFilterInput>;
  locale?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<ReviewFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<ReviewFiltersInput>>>;
  product?: InputMaybe<ProductFiltersInput>;
  publishedAt?: InputMaybe<DateTimeFilterInput>;
  rating?: InputMaybe<StringFilterInput>;
  reply?: InputMaybe<JsonFilterInput>;
  response?: InputMaybe<JsonFilterInput>;
  reviewed_at?: InputMaybe<DateTimeFilterInput>;
  status?: InputMaybe<StringFilterInput>;
  updatedAt?: InputMaybe<DateTimeFilterInput>;
  user?: InputMaybe<UsersPermissionsUserFiltersInput>;
  verified?: InputMaybe<BooleanFilterInput>;
};

export type ReviewInput = {
  approved?: InputMaybe<Scalars['Boolean']['input']>;
  archive_date?: InputMaybe<Scalars['DateTime']['input']>;
  archive_reason?: InputMaybe<Enum_Review_Archive_Reason>;
  audit_log?: InputMaybe<Scalars['JSON']['input']>;
  author_name?: InputMaybe<Scalars['String']['input']>;
  comment?: InputMaybe<Scalars['JSON']['input']>;
  content?: InputMaybe<Scalars['String']['input']>;
  flags?: InputMaybe<Scalars['Int']['input']>;
  helpful_count?: InputMaybe<Scalars['Int']['input']>;
  images?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  is_archived?: InputMaybe<Scalars['Boolean']['input']>;
  is_featured?: InputMaybe<Scalars['Boolean']['input']>;
  likes?: InputMaybe<Scalars['Long']['input']>;
  locale?: InputMaybe<Scalars['String']['input']>;
  product?: InputMaybe<Scalars['ID']['input']>;
  publishedAt?: InputMaybe<Scalars['DateTime']['input']>;
  rating?: InputMaybe<Enum_Review_Rating>;
  reply?: InputMaybe<Scalars['JSON']['input']>;
  response?: InputMaybe<Scalars['JSON']['input']>;
  reviewed_at?: InputMaybe<Scalars['DateTime']['input']>;
  status?: InputMaybe<Enum_Review_Status>;
  user?: InputMaybe<Scalars['ID']['input']>;
  verified?: InputMaybe<Scalars['Boolean']['input']>;
  videos?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
};

export type ReviewRelationResponseCollection = {
  __typename: 'ReviewRelationResponseCollection';
  data: Array<ReviewEntity>;
};

export type StringFilterInput = {
  and?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
  between?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
  contains?: InputMaybe<Scalars['String']['input']>;
  containsi?: InputMaybe<Scalars['String']['input']>;
  endsWith?: InputMaybe<Scalars['String']['input']>;
  eq?: InputMaybe<Scalars['String']['input']>;
  eqi?: InputMaybe<Scalars['String']['input']>;
  gt?: InputMaybe<Scalars['String']['input']>;
  gte?: InputMaybe<Scalars['String']['input']>;
  in?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
  lt?: InputMaybe<Scalars['String']['input']>;
  lte?: InputMaybe<Scalars['String']['input']>;
  ne?: InputMaybe<Scalars['String']['input']>;
  nei?: InputMaybe<Scalars['String']['input']>;
  not?: InputMaybe<StringFilterInput>;
  notContains?: InputMaybe<Scalars['String']['input']>;
  notContainsi?: InputMaybe<Scalars['String']['input']>;
  notIn?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
  notNull?: InputMaybe<Scalars['Boolean']['input']>;
  null?: InputMaybe<Scalars['Boolean']['input']>;
  or?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type Tag = {
  __typename: 'Tag';
  categories?: Maybe<CategoryRelationResponseCollection>;
  color_code?: Maybe<Enum_Tag_Color_Code>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  description?: Maybe<Scalars['JSON']['output']>;
  is_featured?: Maybe<Scalars['Boolean']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  priority?: Maybe<Scalars['Int']['output']>;
  products?: Maybe<ProductRelationResponseCollection>;
  publishedAt?: Maybe<Scalars['DateTime']['output']>;
  slug?: Maybe<Scalars['String']['output']>;
  tag_type?: Maybe<Enum_Tag_Tag_Type>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};


export type TagCategoriesArgs = {
  filters?: InputMaybe<CategoryFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type TagProductsArgs = {
  filters?: InputMaybe<ProductFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};

export type TagEntity = {
  __typename: 'TagEntity';
  attributes?: Maybe<Tag>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type TagEntityResponse = {
  __typename: 'TagEntityResponse';
  data?: Maybe<TagEntity>;
};

export type TagEntityResponseCollection = {
  __typename: 'TagEntityResponseCollection';
  data: Array<TagEntity>;
  meta: ResponseCollectionMeta;
};

export type TagFiltersInput = {
  and?: InputMaybe<Array<InputMaybe<TagFiltersInput>>>;
  categories?: InputMaybe<CategoryFiltersInput>;
  color_code?: InputMaybe<StringFilterInput>;
  createdAt?: InputMaybe<DateTimeFilterInput>;
  description?: InputMaybe<JsonFilterInput>;
  id?: InputMaybe<IdFilterInput>;
  is_featured?: InputMaybe<BooleanFilterInput>;
  name?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<TagFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<TagFiltersInput>>>;
  priority?: InputMaybe<IntFilterInput>;
  products?: InputMaybe<ProductFiltersInput>;
  publishedAt?: InputMaybe<DateTimeFilterInput>;
  slug?: InputMaybe<StringFilterInput>;
  tag_type?: InputMaybe<StringFilterInput>;
  updatedAt?: InputMaybe<DateTimeFilterInput>;
};

export type TagInput = {
  categories?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  color_code?: InputMaybe<Enum_Tag_Color_Code>;
  description?: InputMaybe<Scalars['JSON']['input']>;
  is_featured?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  priority?: InputMaybe<Scalars['Int']['input']>;
  products?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  publishedAt?: InputMaybe<Scalars['DateTime']['input']>;
  slug?: InputMaybe<Scalars['String']['input']>;
  tag_type?: InputMaybe<Enum_Tag_Tag_Type>;
};

export type TagRelationResponseCollection = {
  __typename: 'TagRelationResponseCollection';
  data: Array<TagEntity>;
};

export type UploadFile = {
  __typename: 'UploadFile';
  alternativeText?: Maybe<Scalars['String']['output']>;
  caption?: Maybe<Scalars['String']['output']>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  ext?: Maybe<Scalars['String']['output']>;
  formats?: Maybe<Scalars['JSON']['output']>;
  hash: Scalars['String']['output'];
  height?: Maybe<Scalars['Int']['output']>;
  mime: Scalars['String']['output'];
  name: Scalars['String']['output'];
  previewUrl?: Maybe<Scalars['String']['output']>;
  provider: Scalars['String']['output'];
  provider_metadata?: Maybe<Scalars['JSON']['output']>;
  related?: Maybe<Array<Maybe<GenericMorph>>>;
  size: Scalars['Float']['output'];
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
  url: Scalars['String']['output'];
  width?: Maybe<Scalars['Int']['output']>;
};

export type UploadFileEntity = {
  __typename: 'UploadFileEntity';
  attributes?: Maybe<UploadFile>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type UploadFileEntityResponse = {
  __typename: 'UploadFileEntityResponse';
  data?: Maybe<UploadFileEntity>;
};

export type UploadFileEntityResponseCollection = {
  __typename: 'UploadFileEntityResponseCollection';
  data: Array<UploadFileEntity>;
  meta: ResponseCollectionMeta;
};

export type UploadFileFiltersInput = {
  alternativeText?: InputMaybe<StringFilterInput>;
  and?: InputMaybe<Array<InputMaybe<UploadFileFiltersInput>>>;
  caption?: InputMaybe<StringFilterInput>;
  createdAt?: InputMaybe<DateTimeFilterInput>;
  ext?: InputMaybe<StringFilterInput>;
  folder?: InputMaybe<UploadFolderFiltersInput>;
  folderPath?: InputMaybe<StringFilterInput>;
  formats?: InputMaybe<JsonFilterInput>;
  hash?: InputMaybe<StringFilterInput>;
  height?: InputMaybe<IntFilterInput>;
  id?: InputMaybe<IdFilterInput>;
  mime?: InputMaybe<StringFilterInput>;
  name?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<UploadFileFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<UploadFileFiltersInput>>>;
  previewUrl?: InputMaybe<StringFilterInput>;
  provider?: InputMaybe<StringFilterInput>;
  provider_metadata?: InputMaybe<JsonFilterInput>;
  size?: InputMaybe<FloatFilterInput>;
  updatedAt?: InputMaybe<DateTimeFilterInput>;
  url?: InputMaybe<StringFilterInput>;
  width?: InputMaybe<IntFilterInput>;
};

export type UploadFileInput = {
  alternativeText?: InputMaybe<Scalars['String']['input']>;
  caption?: InputMaybe<Scalars['String']['input']>;
  ext?: InputMaybe<Scalars['String']['input']>;
  folder?: InputMaybe<Scalars['ID']['input']>;
  folderPath?: InputMaybe<Scalars['String']['input']>;
  formats?: InputMaybe<Scalars['JSON']['input']>;
  hash?: InputMaybe<Scalars['String']['input']>;
  height?: InputMaybe<Scalars['Int']['input']>;
  mime?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  previewUrl?: InputMaybe<Scalars['String']['input']>;
  provider?: InputMaybe<Scalars['String']['input']>;
  provider_metadata?: InputMaybe<Scalars['JSON']['input']>;
  size?: InputMaybe<Scalars['Float']['input']>;
  url?: InputMaybe<Scalars['String']['input']>;
  width?: InputMaybe<Scalars['Int']['input']>;
};

export type UploadFileRelationResponseCollection = {
  __typename: 'UploadFileRelationResponseCollection';
  data: Array<UploadFileEntity>;
};

export type UploadFolder = {
  __typename: 'UploadFolder';
  children?: Maybe<UploadFolderRelationResponseCollection>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  files?: Maybe<UploadFileRelationResponseCollection>;
  name: Scalars['String']['output'];
  parent?: Maybe<UploadFolderEntityResponse>;
  path: Scalars['String']['output'];
  pathId: Scalars['Int']['output'];
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};


export type UploadFolderChildrenArgs = {
  filters?: InputMaybe<UploadFolderFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type UploadFolderFilesArgs = {
  filters?: InputMaybe<UploadFileFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};

export type UploadFolderEntity = {
  __typename: 'UploadFolderEntity';
  attributes?: Maybe<UploadFolder>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type UploadFolderEntityResponse = {
  __typename: 'UploadFolderEntityResponse';
  data?: Maybe<UploadFolderEntity>;
};

export type UploadFolderEntityResponseCollection = {
  __typename: 'UploadFolderEntityResponseCollection';
  data: Array<UploadFolderEntity>;
  meta: ResponseCollectionMeta;
};

export type UploadFolderFiltersInput = {
  and?: InputMaybe<Array<InputMaybe<UploadFolderFiltersInput>>>;
  children?: InputMaybe<UploadFolderFiltersInput>;
  createdAt?: InputMaybe<DateTimeFilterInput>;
  files?: InputMaybe<UploadFileFiltersInput>;
  id?: InputMaybe<IdFilterInput>;
  name?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<UploadFolderFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<UploadFolderFiltersInput>>>;
  parent?: InputMaybe<UploadFolderFiltersInput>;
  path?: InputMaybe<StringFilterInput>;
  pathId?: InputMaybe<IntFilterInput>;
  updatedAt?: InputMaybe<DateTimeFilterInput>;
};

export type UploadFolderInput = {
  children?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  files?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  name?: InputMaybe<Scalars['String']['input']>;
  parent?: InputMaybe<Scalars['ID']['input']>;
  path?: InputMaybe<Scalars['String']['input']>;
  pathId?: InputMaybe<Scalars['Int']['input']>;
};

export type UploadFolderRelationResponseCollection = {
  __typename: 'UploadFolderRelationResponseCollection';
  data: Array<UploadFolderEntity>;
};

export type UsersPermissionsCreateRolePayload = {
  __typename: 'UsersPermissionsCreateRolePayload';
  ok: Scalars['Boolean']['output'];
};

export type UsersPermissionsDeleteRolePayload = {
  __typename: 'UsersPermissionsDeleteRolePayload';
  ok: Scalars['Boolean']['output'];
};

export type UsersPermissionsLoginInput = {
  identifier: Scalars['String']['input'];
  password: Scalars['String']['input'];
  provider?: Scalars['String']['input'];
};

export type UsersPermissionsLoginPayload = {
  __typename: 'UsersPermissionsLoginPayload';
  jwt?: Maybe<Scalars['String']['output']>;
  user: UsersPermissionsMe;
};

export type UsersPermissionsMe = {
  __typename: 'UsersPermissionsMe';
  blocked?: Maybe<Scalars['Boolean']['output']>;
  confirmed?: Maybe<Scalars['Boolean']['output']>;
  email?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  role?: Maybe<UsersPermissionsMeRole>;
  username: Scalars['String']['output'];
};

export type UsersPermissionsMeRole = {
  __typename: 'UsersPermissionsMeRole';
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  type?: Maybe<Scalars['String']['output']>;
};

export type UsersPermissionsPasswordPayload = {
  __typename: 'UsersPermissionsPasswordPayload';
  ok: Scalars['Boolean']['output'];
};

export type UsersPermissionsPermission = {
  __typename: 'UsersPermissionsPermission';
  action: Scalars['String']['output'];
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  role?: Maybe<UsersPermissionsRoleEntityResponse>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};

export type UsersPermissionsPermissionEntity = {
  __typename: 'UsersPermissionsPermissionEntity';
  attributes?: Maybe<UsersPermissionsPermission>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type UsersPermissionsPermissionFiltersInput = {
  action?: InputMaybe<StringFilterInput>;
  and?: InputMaybe<Array<InputMaybe<UsersPermissionsPermissionFiltersInput>>>;
  createdAt?: InputMaybe<DateTimeFilterInput>;
  id?: InputMaybe<IdFilterInput>;
  not?: InputMaybe<UsersPermissionsPermissionFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<UsersPermissionsPermissionFiltersInput>>>;
  role?: InputMaybe<UsersPermissionsRoleFiltersInput>;
  updatedAt?: InputMaybe<DateTimeFilterInput>;
};

export type UsersPermissionsPermissionRelationResponseCollection = {
  __typename: 'UsersPermissionsPermissionRelationResponseCollection';
  data: Array<UsersPermissionsPermissionEntity>;
};

export type UsersPermissionsRegisterInput = {
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
  username: Scalars['String']['input'];
};

export type UsersPermissionsRole = {
  __typename: 'UsersPermissionsRole';
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  permissions?: Maybe<UsersPermissionsPermissionRelationResponseCollection>;
  type?: Maybe<Scalars['String']['output']>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
  users?: Maybe<UsersPermissionsUserRelationResponseCollection>;
};


export type UsersPermissionsRolePermissionsArgs = {
  filters?: InputMaybe<UsersPermissionsPermissionFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type UsersPermissionsRoleUsersArgs = {
  filters?: InputMaybe<UsersPermissionsUserFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};

export type UsersPermissionsRoleEntity = {
  __typename: 'UsersPermissionsRoleEntity';
  attributes?: Maybe<UsersPermissionsRole>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type UsersPermissionsRoleEntityResponse = {
  __typename: 'UsersPermissionsRoleEntityResponse';
  data?: Maybe<UsersPermissionsRoleEntity>;
};

export type UsersPermissionsRoleEntityResponseCollection = {
  __typename: 'UsersPermissionsRoleEntityResponseCollection';
  data: Array<UsersPermissionsRoleEntity>;
  meta: ResponseCollectionMeta;
};

export type UsersPermissionsRoleFiltersInput = {
  and?: InputMaybe<Array<InputMaybe<UsersPermissionsRoleFiltersInput>>>;
  createdAt?: InputMaybe<DateTimeFilterInput>;
  description?: InputMaybe<StringFilterInput>;
  id?: InputMaybe<IdFilterInput>;
  name?: InputMaybe<StringFilterInput>;
  not?: InputMaybe<UsersPermissionsRoleFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<UsersPermissionsRoleFiltersInput>>>;
  permissions?: InputMaybe<UsersPermissionsPermissionFiltersInput>;
  type?: InputMaybe<StringFilterInput>;
  updatedAt?: InputMaybe<DateTimeFilterInput>;
  users?: InputMaybe<UsersPermissionsUserFiltersInput>;
};

export type UsersPermissionsRoleInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  permissions?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  type?: InputMaybe<Scalars['String']['input']>;
  users?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
};

export type UsersPermissionsUpdateRolePayload = {
  __typename: 'UsersPermissionsUpdateRolePayload';
  ok: Scalars['Boolean']['output'];
};

export type UsersPermissionsUser = {
  __typename: 'UsersPermissionsUser';
  avatar?: Maybe<UploadFileEntityResponse>;
  birth_day?: Maybe<Scalars['Date']['output']>;
  blocked?: Maybe<Scalars['Boolean']['output']>;
  confirmed?: Maybe<Scalars['Boolean']['output']>;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  date_of_birth?: Maybe<Scalars['Date']['output']>;
  email: Scalars['String']['output'];
  gender?: Maybe<Enum_Userspermissionsuser_Gender>;
  last_login?: Maybe<Scalars['DateTime']['output']>;
  marriage_day?: Maybe<Scalars['Date']['output']>;
  orders?: Maybe<OrderRelationResponseCollection>;
  phone_number?: Maybe<Scalars['String']['output']>;
  provider?: Maybe<Scalars['String']['output']>;
  referrals?: Maybe<ReferralRelationResponseCollection>;
  reviews?: Maybe<ReviewRelationResponseCollection>;
  role?: Maybe<UsersPermissionsRoleEntityResponse>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
  username: Scalars['String']['output'];
};


export type UsersPermissionsUserOrdersArgs = {
  filters?: InputMaybe<OrderFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type UsersPermissionsUserReferralsArgs = {
  filters?: InputMaybe<ReferralFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type UsersPermissionsUserReviewsArgs = {
  filters?: InputMaybe<ReviewFiltersInput>;
  pagination?: InputMaybe<PaginationArg>;
  publicationState?: InputMaybe<PublicationState>;
  sort?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};

export type UsersPermissionsUserEntity = {
  __typename: 'UsersPermissionsUserEntity';
  attributes?: Maybe<UsersPermissionsUser>;
  id?: Maybe<Scalars['ID']['output']>;
};

export type UsersPermissionsUserEntityResponse = {
  __typename: 'UsersPermissionsUserEntityResponse';
  data?: Maybe<UsersPermissionsUserEntity>;
};

export type UsersPermissionsUserEntityResponseCollection = {
  __typename: 'UsersPermissionsUserEntityResponseCollection';
  data: Array<UsersPermissionsUserEntity>;
  meta: ResponseCollectionMeta;
};

export type UsersPermissionsUserFiltersInput = {
  and?: InputMaybe<Array<InputMaybe<UsersPermissionsUserFiltersInput>>>;
  birth_day?: InputMaybe<DateFilterInput>;
  blocked?: InputMaybe<BooleanFilterInput>;
  confirmationToken?: InputMaybe<StringFilterInput>;
  confirmed?: InputMaybe<BooleanFilterInput>;
  createdAt?: InputMaybe<DateTimeFilterInput>;
  date_of_birth?: InputMaybe<DateFilterInput>;
  email?: InputMaybe<StringFilterInput>;
  gender?: InputMaybe<StringFilterInput>;
  id?: InputMaybe<IdFilterInput>;
  last_login?: InputMaybe<DateTimeFilterInput>;
  marriage_day?: InputMaybe<DateFilterInput>;
  not?: InputMaybe<UsersPermissionsUserFiltersInput>;
  or?: InputMaybe<Array<InputMaybe<UsersPermissionsUserFiltersInput>>>;
  orders?: InputMaybe<OrderFiltersInput>;
  password?: InputMaybe<StringFilterInput>;
  phone_number?: InputMaybe<StringFilterInput>;
  provider?: InputMaybe<StringFilterInput>;
  referrals?: InputMaybe<ReferralFiltersInput>;
  resetPasswordToken?: InputMaybe<StringFilterInput>;
  reviews?: InputMaybe<ReviewFiltersInput>;
  role?: InputMaybe<UsersPermissionsRoleFiltersInput>;
  updatedAt?: InputMaybe<DateTimeFilterInput>;
  username?: InputMaybe<StringFilterInput>;
};

export type UsersPermissionsUserInput = {
  avatar?: InputMaybe<Scalars['ID']['input']>;
  birth_day?: InputMaybe<Scalars['Date']['input']>;
  blocked?: InputMaybe<Scalars['Boolean']['input']>;
  confirmationToken?: InputMaybe<Scalars['String']['input']>;
  confirmed?: InputMaybe<Scalars['Boolean']['input']>;
  date_of_birth?: InputMaybe<Scalars['Date']['input']>;
  email?: InputMaybe<Scalars['String']['input']>;
  gender?: InputMaybe<Enum_Userspermissionsuser_Gender>;
  last_login?: InputMaybe<Scalars['DateTime']['input']>;
  marriage_day?: InputMaybe<Scalars['Date']['input']>;
  orders?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  password?: InputMaybe<Scalars['String']['input']>;
  phone_number?: InputMaybe<Scalars['String']['input']>;
  provider?: InputMaybe<Scalars['String']['input']>;
  referrals?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  resetPasswordToken?: InputMaybe<Scalars['String']['input']>;
  reviews?: InputMaybe<Array<InputMaybe<Scalars['ID']['input']>>>;
  role?: InputMaybe<Scalars['ID']['input']>;
  username?: InputMaybe<Scalars['String']['input']>;
};

export type UsersPermissionsUserRelationResponseCollection = {
  __typename: 'UsersPermissionsUserRelationResponseCollection';
  data: Array<UsersPermissionsUserEntity>;
};

/**
 * A Directive provides a way to describe alternate runtime execution and type validation behavior in a GraphQL document.
 *
 * In some cases, you need to provide options to alter GraphQL's execution behavior in ways field arguments will not suffice, such as conditionally including or skipping a field. Directives provide this by describing additional information to the executor.
 */
export type __Directive = {
  __typename: '__Directive';
  name: Scalars['String']['output'];
  description?: Maybe<Scalars['String']['output']>;
  isRepeatable: Scalars['Boolean']['output'];
  locations: Array<__DirectiveLocation>;
  args: Array<__InputValue>;
};


/**
 * A Directive provides a way to describe alternate runtime execution and type validation behavior in a GraphQL document.
 *
 * In some cases, you need to provide options to alter GraphQL's execution behavior in ways field arguments will not suffice, such as conditionally including or skipping a field. Directives provide this by describing additional information to the executor.
 */
export type __DirectiveArgsArgs = {
  includeDeprecated?: InputMaybe<Scalars['Boolean']['input']>;
};

/** A Directive can be adjacent to many parts of the GraphQL language, a __DirectiveLocation describes one such possible adjacencies. */
export enum __DirectiveLocation {
  /** Location adjacent to a query operation. */
  Query = 'QUERY',
  /** Location adjacent to a mutation operation. */
  Mutation = 'MUTATION',
  /** Location adjacent to a subscription operation. */
  Subscription = 'SUBSCRIPTION',
  /** Location adjacent to a field. */
  Field = 'FIELD',
  /** Location adjacent to a fragment definition. */
  FragmentDefinition = 'FRAGMENT_DEFINITION',
  /** Location adjacent to a fragment spread. */
  FragmentSpread = 'FRAGMENT_SPREAD',
  /** Location adjacent to an inline fragment. */
  InlineFragment = 'INLINE_FRAGMENT',
  /** Location adjacent to a variable definition. */
  VariableDefinition = 'VARIABLE_DEFINITION',
  /** Location adjacent to a schema definition. */
  Schema = 'SCHEMA',
  /** Location adjacent to a scalar definition. */
  Scalar = 'SCALAR',
  /** Location adjacent to an object type definition. */
  Object = 'OBJECT',
  /** Location adjacent to a field definition. */
  FieldDefinition = 'FIELD_DEFINITION',
  /** Location adjacent to an argument definition. */
  ArgumentDefinition = 'ARGUMENT_DEFINITION',
  /** Location adjacent to an interface definition. */
  Interface = 'INTERFACE',
  /** Location adjacent to a union definition. */
  Union = 'UNION',
  /** Location adjacent to an enum definition. */
  Enum = 'ENUM',
  /** Location adjacent to an enum value definition. */
  EnumValue = 'ENUM_VALUE',
  /** Location adjacent to an input object type definition. */
  InputObject = 'INPUT_OBJECT',
  /** Location adjacent to an input object field definition. */
  InputFieldDefinition = 'INPUT_FIELD_DEFINITION'
}

/** One possible value for a given Enum. Enum values are unique values, not a placeholder for a string or numeric value. However an Enum value is returned in a JSON response as a string. */
export type __EnumValue = {
  __typename: '__EnumValue';
  name: Scalars['String']['output'];
  description?: Maybe<Scalars['String']['output']>;
  isDeprecated: Scalars['Boolean']['output'];
  deprecationReason?: Maybe<Scalars['String']['output']>;
};

/** Object and Interface types are described by a list of Fields, each of which has a name, potentially a list of arguments, and a return type. */
export type __Field = {
  __typename: '__Field';
  name: Scalars['String']['output'];
  description?: Maybe<Scalars['String']['output']>;
  args: Array<__InputValue>;
  type: __Type;
  isDeprecated: Scalars['Boolean']['output'];
  deprecationReason?: Maybe<Scalars['String']['output']>;
};


/** Object and Interface types are described by a list of Fields, each of which has a name, potentially a list of arguments, and a return type. */
export type __FieldArgsArgs = {
  includeDeprecated?: InputMaybe<Scalars['Boolean']['input']>;
};

/** Arguments provided to Fields or Directives and the input fields of an InputObject are represented as Input Values which describe their type and optionally a default value. */
export type __InputValue = {
  __typename: '__InputValue';
  name: Scalars['String']['output'];
  description?: Maybe<Scalars['String']['output']>;
  type: __Type;
  /** A GraphQL-formatted string representing the default value for this input value. */
  defaultValue?: Maybe<Scalars['String']['output']>;
  isDeprecated: Scalars['Boolean']['output'];
  deprecationReason?: Maybe<Scalars['String']['output']>;
};

/** A GraphQL Schema defines the capabilities of a GraphQL server. It exposes all available types and directives on the server, as well as the entry points for query, mutation, and subscription operations. */
export type __Schema = {
  __typename: '__Schema';
  description?: Maybe<Scalars['String']['output']>;
  /** A list of all types supported by this server. */
  types: Array<__Type>;
  /** The type that query operations will be rooted at. */
  queryType: __Type;
  /** If this server supports mutation, the type that mutation operations will be rooted at. */
  mutationType?: Maybe<__Type>;
  /** If this server support subscription, the type that subscription operations will be rooted at. */
  subscriptionType?: Maybe<__Type>;
  /** A list of all directives supported by this server. */
  directives: Array<__Directive>;
};

/**
 * The fundamental unit of any GraphQL Schema is the type. There are many kinds of types in GraphQL as represented by the `__TypeKind` enum.
 *
 * Depending on the kind of a type, certain fields describe information about that type. Scalar types provide no information beyond a name, description and optional `specifiedByURL`, while Enum types provide their values. Object and Interface types provide the fields they describe. Abstract types, Union and Interface, provide the Object types possible at runtime. List and NonNull types compose other types.
 */
export type __Type = {
  __typename: '__Type';
  kind: __TypeKind;
  name?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  specifiedByURL?: Maybe<Scalars['String']['output']>;
  fields?: Maybe<Array<__Field>>;
  interfaces?: Maybe<Array<__Type>>;
  possibleTypes?: Maybe<Array<__Type>>;
  enumValues?: Maybe<Array<__EnumValue>>;
  inputFields?: Maybe<Array<__InputValue>>;
  ofType?: Maybe<__Type>;
  isOneOf?: Maybe<Scalars['Boolean']['output']>;
};


/**
 * The fundamental unit of any GraphQL Schema is the type. There are many kinds of types in GraphQL as represented by the `__TypeKind` enum.
 *
 * Depending on the kind of a type, certain fields describe information about that type. Scalar types provide no information beyond a name, description and optional `specifiedByURL`, while Enum types provide their values. Object and Interface types provide the fields they describe. Abstract types, Union and Interface, provide the Object types possible at runtime. List and NonNull types compose other types.
 */
export type __TypeFieldsArgs = {
  includeDeprecated?: InputMaybe<Scalars['Boolean']['input']>;
};


/**
 * The fundamental unit of any GraphQL Schema is the type. There are many kinds of types in GraphQL as represented by the `__TypeKind` enum.
 *
 * Depending on the kind of a type, certain fields describe information about that type. Scalar types provide no information beyond a name, description and optional `specifiedByURL`, while Enum types provide their values. Object and Interface types provide the fields they describe. Abstract types, Union and Interface, provide the Object types possible at runtime. List and NonNull types compose other types.
 */
export type __TypeEnumValuesArgs = {
  includeDeprecated?: InputMaybe<Scalars['Boolean']['input']>;
};


/**
 * The fundamental unit of any GraphQL Schema is the type. There are many kinds of types in GraphQL as represented by the `__TypeKind` enum.
 *
 * Depending on the kind of a type, certain fields describe information about that type. Scalar types provide no information beyond a name, description and optional `specifiedByURL`, while Enum types provide their values. Object and Interface types provide the fields they describe. Abstract types, Union and Interface, provide the Object types possible at runtime. List and NonNull types compose other types.
 */
export type __TypeInputFieldsArgs = {
  includeDeprecated?: InputMaybe<Scalars['Boolean']['input']>;
};

/** An enum describing what kind of type a given `__Type` is. */
export enum __TypeKind {
  /** Indicates this type is a scalar. */
  Scalar = 'SCALAR',
  /** Indicates this type is an object. `fields` and `interfaces` are valid fields. */
  Object = 'OBJECT',
  /** Indicates this type is an interface. `fields`, `interfaces`, and `possibleTypes` are valid fields. */
  Interface = 'INTERFACE',
  /** Indicates this type is a union. `possibleTypes` is a valid field. */
  Union = 'UNION',
  /** Indicates this type is an enum. `enumValues` is a valid field. */
  Enum = 'ENUM',
  /** Indicates this type is an input object. `inputFields` is a valid field. */
  InputObject = 'INPUT_OBJECT',
  /** Indicates this type is a list. `ofType` is a valid field. */
  List = 'LIST',
  /** Indicates this type is a non-null. `ofType` is a valid field. */
  NonNull = 'NON_NULL'
}

export type CategoryFieldsFragment = { __typename: 'CategoryEntity', id?: string | null, attributes?: { __typename: 'Category', name: string, slug?: string | null } | null };

export type MediaFileFragment = { __typename: 'UploadFile', url: string, alternativeText?: string | null, width?: number | null, height?: number | null, size: number, mime: string };

export type MediaSingleFragment = { __typename: 'UploadFileEntityResponse', data?: { __typename: 'UploadFileEntity', attributes?: { __typename: 'UploadFile', url: string, alternativeText?: string | null, width?: number | null, height?: number | null, size: number, mime: string } | null } | null };

export type MediaManyFragment = { __typename: 'UploadFileRelationResponseCollection', data: Array<{ __typename: 'UploadFileEntity', attributes?: { __typename: 'UploadFile', url: string, alternativeText?: string | null, width?: number | null, height?: number | null, size: number, mime: string } | null }> };

export type UploadFileCoreFragment = { __typename: 'UploadFile', url: string, alternativeText?: string | null, mime: string, width?: number | null, height?: number | null, size: number, name: string, ext?: string | null, hash: string, provider: string, createdAt?: string | null, updatedAt?: string | null };

export type UploadFileEntityCoreFragment = { __typename: 'UploadFileEntity', id?: string | null, attributes?: { __typename: 'UploadFile', url: string, alternativeText?: string | null, mime: string, width?: number | null, height?: number | null, size: number, name: string, ext?: string | null, hash: string, provider: string, createdAt?: string | null, updatedAt?: string | null } | null };

export type UploadFileSingleFragment = { __typename: 'UploadFileEntityResponse', data?: { __typename: 'UploadFileEntity', id?: string | null, attributes?: { __typename: 'UploadFile', url: string, alternativeText?: string | null, mime: string, width?: number | null, height?: number | null, size: number, name: string, ext?: string | null, hash: string, provider: string, createdAt?: string | null, updatedAt?: string | null } | null } | null };

export type UploadFileManyFragment = { __typename: 'UploadFileEntityResponseCollection', data: Array<{ __typename: 'UploadFileEntity', id?: string | null, attributes?: { __typename: 'UploadFile', url: string, alternativeText?: string | null, mime: string, width?: number | null, height?: number | null, size: number, name: string, ext?: string | null, hash: string, provider: string, createdAt?: string | null, updatedAt?: string | null } | null }> };

export type CategoryCoreFragment = { __typename: 'Category', name: string, slug?: string | null };

export type CategoryEntityCoreFragment = { __typename: 'CategoryEntity', id?: string | null, attributes?: { __typename: 'Category', name: string, slug?: string | null } | null };

export type CategoryManyFragment = { __typename: 'CategoryRelationResponseCollection', data: Array<{ __typename: 'CategoryEntity', id?: string | null, attributes?: { __typename: 'Category', name: string, slug?: string | null } | null }> };

export type TagCoreFragment = { __typename: 'Tag', name?: string | null, slug?: string | null };

export type TagEntityCoreFragment = { __typename: 'TagEntity', id?: string | null, attributes?: { __typename: 'Tag', name?: string | null, slug?: string | null } | null };

export type TagManyFragment = { __typename: 'TagRelationResponseCollection', data: Array<{ __typename: 'TagEntity', id?: string | null, attributes?: { __typename: 'Tag', name?: string | null, slug?: string | null } | null }> };

export type BrandTierCoreFragment = { __typename: 'BrandTier', name?: string | null };

export type BrandTierEntityCoreFragment = { __typename: 'BrandTierEntity', id?: string | null, attributes?: { __typename: 'BrandTier', name?: string | null } | null };

export type BrandTierManyFragment = { __typename: 'BrandTierRelationResponseCollection', data: Array<{ __typename: 'BrandTierEntity', id?: string | null, attributes?: { __typename: 'BrandTier', name?: string | null } | null }> };

export type AudienceCategoryCoreFragment = { __typename: 'AudienceCategory', name: string, slug?: string | null };

export type AudienceCategoryEntityCoreFragment = { __typename: 'AudienceCategoryEntity', id?: string | null, attributes?: { __typename: 'AudienceCategory', name: string, slug?: string | null } | null };

export type AudienceCategoryManyFragment = { __typename: 'AudienceCategoryRelationResponseCollection', data: Array<{ __typename: 'AudienceCategoryEntity', id?: string | null, attributes?: { __typename: 'AudienceCategory', name: string, slug?: string | null } | null }> };

export type AgeGroupCoreFragment = { __typename: 'AgeGroup', name?: string | null };

export type AgeGroupEntityCoreFragment = { __typename: 'AgeGroupEntity', id?: string | null, attributes?: { __typename: 'AgeGroup', name?: string | null } | null };

export type AgeGroupManyFragment = { __typename: 'AgeGroupRelationResponseCollection', data: Array<{ __typename: 'AgeGroupEntity', id?: string | null, attributes?: { __typename: 'AgeGroup', name?: string | null } | null }> };

export type GenderGroupCoreFragment = { __typename: 'GenderGroup', name?: string | null };

export type GenderGroupEntityCoreFragment = { __typename: 'GenderGroupEntity', id?: string | null, attributes?: { __typename: 'GenderGroup', name?: string | null } | null };

export type GenderGroupManyFragment = { __typename: 'GenderGroupRelationResponseCollection', data: Array<{ __typename: 'GenderGroupEntity', id?: string | null, attributes?: { __typename: 'GenderGroup', name?: string | null } | null }> };

export type ProductCoreFragment = { __typename: 'Product', cost_price?: any | null, categories?: { __typename: 'CategoryRelationResponseCollection', data: Array<{ __typename: 'CategoryEntity', id?: string | null, attributes?: { __typename: 'Category', name: string, slug?: string | null } | null }> } | null };

export type ProductEntityCoreFragment = { __typename: 'ProductEntity', id?: string | null, attributes?: { __typename: 'Product', cost_price?: any | null, categories?: { __typename: 'CategoryRelationResponseCollection', data: Array<{ __typename: 'CategoryEntity', id?: string | null, attributes?: { __typename: 'Category', name: string, slug?: string | null } | null }> } | null } | null };

export type ProductBasicsFragment = { __typename: 'Product', cost_price?: any | null, categories?: { __typename: 'CategoryRelationResponseCollection', data: Array<{ __typename: 'CategoryEntity', id?: string | null, attributes?: { __typename: 'Category', name: string, slug?: string | null } | null }> } | null };

export type IntrospectionPingQueryVariables = Exact<{ [key: string]: never; }>;


export type IntrospectionPingQuery = { __typename: 'Query', __schema: { __typename: '__Schema', queryType: { __typename: '__Type', name?: string | null } } };

export const CategoryFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CategoryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"CategoryEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}}]}}]}}]} as unknown as DocumentNode<CategoryFieldsFragment, unknown>;
export const MediaFileFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MediaFile"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UploadFile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"alternativeText"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"mime"}}]}}]} as unknown as DocumentNode<MediaFileFragment, unknown>;
export const MediaSingleFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MediaSingle"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UploadFileEntityResponse"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MediaFile"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MediaFile"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UploadFile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"alternativeText"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"mime"}}]}}]} as unknown as DocumentNode<MediaSingleFragment, unknown>;
export const MediaManyFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MediaMany"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UploadFileRelationResponseCollection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MediaFile"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MediaFile"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UploadFile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"alternativeText"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"mime"}}]}}]} as unknown as DocumentNode<MediaManyFragment, unknown>;
export const UploadFileCoreFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"UploadFileCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UploadFile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"alternativeText"}},{"kind":"Field","name":{"kind":"Name","value":"mime"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"ext"}},{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"provider"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UploadFileCoreFragment, unknown>;
export const UploadFileEntityCoreFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"UploadFileEntityCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UploadFileEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"UploadFileCore"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"UploadFileCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UploadFile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"alternativeText"}},{"kind":"Field","name":{"kind":"Name","value":"mime"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"ext"}},{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"provider"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UploadFileEntityCoreFragment, unknown>;
export const UploadFileSingleFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"UploadFileSingle"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UploadFileEntityResponse"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"UploadFileEntityCore"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"UploadFileCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UploadFile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"alternativeText"}},{"kind":"Field","name":{"kind":"Name","value":"mime"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"ext"}},{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"provider"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"UploadFileEntityCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UploadFileEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"UploadFileCore"}}]}}]}}]} as unknown as DocumentNode<UploadFileSingleFragment, unknown>;
export const UploadFileManyFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"UploadFileMany"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UploadFileEntityResponseCollection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"UploadFileEntityCore"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"UploadFileCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UploadFile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"alternativeText"}},{"kind":"Field","name":{"kind":"Name","value":"mime"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"ext"}},{"kind":"Field","name":{"kind":"Name","value":"hash"}},{"kind":"Field","name":{"kind":"Name","value":"provider"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"UploadFileEntityCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UploadFileEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"UploadFileCore"}}]}}]}}]} as unknown as DocumentNode<UploadFileManyFragment, unknown>;
export const CategoryCoreFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CategoryCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Category"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}}]}}]} as unknown as DocumentNode<CategoryCoreFragment, unknown>;
export const CategoryEntityCoreFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CategoryEntityCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"CategoryEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CategoryCore"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CategoryCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Category"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}}]}}]} as unknown as DocumentNode<CategoryEntityCoreFragment, unknown>;
export const CategoryManyFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CategoryMany"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"CategoryRelationResponseCollection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CategoryEntityCore"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CategoryCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Category"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CategoryEntityCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"CategoryEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CategoryCore"}}]}}]}}]} as unknown as DocumentNode<CategoryManyFragment, unknown>;
export const TagCoreFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TagCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Tag"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}}]}}]} as unknown as DocumentNode<TagCoreFragment, unknown>;
export const TagEntityCoreFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TagEntityCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"TagEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TagCore"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TagCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Tag"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}}]}}]} as unknown as DocumentNode<TagEntityCoreFragment, unknown>;
export const TagManyFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TagMany"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"TagRelationResponseCollection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TagEntityCore"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TagCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Tag"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TagEntityCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"TagEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"TagCore"}}]}}]}}]} as unknown as DocumentNode<TagManyFragment, unknown>;
export const BrandTierCoreFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"BrandTierCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BrandTier"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]} as unknown as DocumentNode<BrandTierCoreFragment, unknown>;
export const BrandTierEntityCoreFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"BrandTierEntityCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BrandTierEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"BrandTierCore"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"BrandTierCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BrandTier"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]} as unknown as DocumentNode<BrandTierEntityCoreFragment, unknown>;
export const BrandTierManyFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"BrandTierMany"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BrandTierRelationResponseCollection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"BrandTierEntityCore"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"BrandTierCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BrandTier"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"BrandTierEntityCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BrandTierEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"BrandTierCore"}}]}}]}}]} as unknown as DocumentNode<BrandTierManyFragment, unknown>;
export const AudienceCategoryCoreFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AudienceCategoryCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AudienceCategory"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}}]}}]} as unknown as DocumentNode<AudienceCategoryCoreFragment, unknown>;
export const AudienceCategoryEntityCoreFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AudienceCategoryEntityCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AudienceCategoryEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AudienceCategoryCore"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AudienceCategoryCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AudienceCategory"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}}]}}]} as unknown as DocumentNode<AudienceCategoryEntityCoreFragment, unknown>;
export const AudienceCategoryManyFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AudienceCategoryMany"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AudienceCategoryRelationResponseCollection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AudienceCategoryEntityCore"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AudienceCategoryCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AudienceCategory"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AudienceCategoryEntityCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AudienceCategoryEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AudienceCategoryCore"}}]}}]}}]} as unknown as DocumentNode<AudienceCategoryManyFragment, unknown>;
export const AgeGroupCoreFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AgeGroupCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AgeGroup"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]} as unknown as DocumentNode<AgeGroupCoreFragment, unknown>;
export const AgeGroupEntityCoreFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AgeGroupEntityCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AgeGroupEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AgeGroupCore"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AgeGroupCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AgeGroup"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]} as unknown as DocumentNode<AgeGroupEntityCoreFragment, unknown>;
export const AgeGroupManyFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AgeGroupMany"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AgeGroupRelationResponseCollection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AgeGroupEntityCore"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AgeGroupCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AgeGroup"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AgeGroupEntityCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AgeGroupEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AgeGroupCore"}}]}}]}}]} as unknown as DocumentNode<AgeGroupManyFragment, unknown>;
export const GenderGroupCoreFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GenderGroupCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GenderGroup"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]} as unknown as DocumentNode<GenderGroupCoreFragment, unknown>;
export const GenderGroupEntityCoreFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GenderGroupEntityCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GenderGroupEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"GenderGroupCore"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GenderGroupCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GenderGroup"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]} as unknown as DocumentNode<GenderGroupEntityCoreFragment, unknown>;
export const GenderGroupManyFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GenderGroupMany"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GenderGroupRelationResponseCollection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"GenderGroupEntityCore"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GenderGroupCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GenderGroup"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"GenderGroupEntityCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GenderGroupEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"GenderGroupCore"}}]}}]}}]} as unknown as DocumentNode<GenderGroupManyFragment, unknown>;
export const ProductCoreFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProductCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Product"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cost_price"}},{"kind":"Field","name":{"kind":"Name","value":"categories"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CategoryEntityCore"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CategoryCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Category"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CategoryEntityCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"CategoryEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CategoryCore"}}]}}]}}]} as unknown as DocumentNode<ProductCoreFragment, unknown>;
export const ProductEntityCoreFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProductEntityCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProductEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ProductCore"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CategoryCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Category"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CategoryEntityCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"CategoryEntity"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CategoryCore"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProductCore"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Product"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cost_price"}},{"kind":"Field","name":{"kind":"Name","value":"categories"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CategoryEntityCore"}}]}}]}}]}}]} as unknown as DocumentNode<ProductEntityCoreFragment, unknown>;
export const ProductBasicsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ProductBasics"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Product"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cost_price"}},{"kind":"Field","name":{"kind":"Name","value":"categories"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}}]}}]}}]}}]}}]} as unknown as DocumentNode<ProductBasicsFragment, unknown>;
export const IntrospectionPingDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"IntrospectionPing"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__schema"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"queryType"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]} as unknown as DocumentNode<IntrospectionPingQuery, IntrospectionPingQueryVariables>;